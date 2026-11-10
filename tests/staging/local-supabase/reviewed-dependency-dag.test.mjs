import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { buildObjectInventory } from './build-database-object-inventory.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dagPath = path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json');

test('reviewed dependency graph references existing source files and known nodes', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const inventory = await buildObjectInventory();
  assert.equal(dag.status, 'BLOCKED');
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.safety.sqlExecutionEnabled, false);
  const ids = new Set([...dag.platformNodes, ...dag.nodes].map(node => node.id));
  for (const node of dag.nodes) {
    for (const dependency of node.requires ?? []) {
      if (dependency.startsWith('UNRESOLVED:')) continue;
      assert.ok(dag.explicitEdges.some(edge => edge[0] === dependency && edge[1] === node.id), 'missing direct dependency edge: ' + dependency + ' -> ' + node.id);
    }
  }
  for (const group of inventory.duplicateGroups) {
    assert.ok(dag.duplicateProvenance.some(item => item.sha256 === group.sha256 && group.paths.includes(item.canonicalTestSource) && group.paths.includes(item.duplicate)), 'duplicate provenance mismatch: ' + group.paths.join(' / '));
  }
  for (const edge of dag.explicitEdges) {
    assert.equal(ids.has(edge[0]), true, 'unknown dependency source: ' + edge[0]);
    assert.equal(ids.has(edge[1]), true, 'unknown dependency target: ' + edge[1]);
  }
  for (const node of dag.nodes) {
    for (const source of node.source ?? []) {
      await access(path.join(root, source));
    }
    for (const dependency of node.requires ?? []) {
      if (dependency.startsWith('UNRESOLVED:')) continue;
      assert.equal(ids.has(dependency), true, 'unknown required node: ' + dependency);
    }
  }
});

test('reviewed dependency graph records local runtime success while preserving the production release gate', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const nodes = [...dag.platformNodes, ...dag.nodes].map(node => node.id);
  const indegree = new Map(nodes.map(id => [id, 0]));
  const outgoing = new Map(nodes.map(id => [id, []]));
  for (const [from, to] of dag.explicitEdges) {
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = nodes.filter(id => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift(); visited++;
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  assert.equal(visited, nodes.length, 'dependency graph contains a cycle');
  assert.ok(dag.blockers.some(item => item.id === 'DAG-002' && item.severity === 'RESOLVED_FOR_LOCAL_REPLAY'));
  assert.equal(dag.status, 'BLOCKED');
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.blockers.find(item => item.id === 'DAG-017')?.severity, 'BLOCKER');
  const manifest = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/replay-manifest.json'), 'utf8'));
  const dag006 = dag.blockers.find(item => item.id === 'DAG-006');
  assert.equal(dag006?.severity, 'RESOLVED_FOR_DISPOSABLE_LOCAL_RUNTIME');
  assert.equal(dag006?.runtimeEvidence?.runId, 42912189296);
  assert.ok(dag006?.evidence?.includes('tests/staging/local-supabase/fixtures/channel-avatar-rls-runtime.test.sql'));
  const manifestDag006 = manifest.blockers.find(item => item.id === 'DAG-006');
  assert.equal(manifestDag006?.severity, 'RESOLVED_FOR_DISPOSABLE_LOCAL_RUNTIME');
  assert.equal(manifestDag006?.runtimeEvidence?.runId, 42912189296);
  for (const id of ['DAG-003', 'DAG-007', 'DAG-008', 'DAG-010', 'DAG-011', 'DAG-013', 'DAG-014', 'DAG-015', 'DAG-016']) {
    const item = dag.blockers.find(blocker => blocker.id === id);
    assert.equal(item?.severity, 'RESOLVED_FOR_DISPOSABLE_LOCAL_RUNTIME', 'local runtime evidence missing for ' + id);
    assert.equal(item?.runtimeEvidence?.runId, 42863700280);
  }
  for (const id of ['DAG-014', 'DAG-015']) {
    const blocker = dag.blockers.find(item => item.id === id);
    assert.ok(blocker.evidence?.includes('tests/staging/local-supabase/fixtures/direct-conversation-eligibility-runtime.test.sql'));
    assert.ok(blocker.evidence?.includes('tests/staging/local-supabase/direct-conversation-concurrency.mjs'));
  }
  assert.ok(dag.nodes.some(node => node.id === 'chat.direct-conversation-rpc' && node.provides.includes('app_private.get_or_create_direct_conversation_impl(uuid)') && node.blockedBy.includes('DAG-015')));
  assert.ok(dag.nodes.some(node => node.id === 'chat.hardening' && node.requires.includes('chat.direct-conversation-rpc') && node.blockedBy.includes('DAG-014') && node.blockedBy.includes('DAG-015')));
});

test('test-only fixtures are present and canonical SQL remains outside the fixture tree', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const patchManifest = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/synthetic-fixture-patches.json'), 'utf8'));
  const requiredFixtures = [
    'legacy-messages-compat.sql',
    '20261107152733_fix_official_membership_invite_duplicate_validation.sql',
    'synthetic-auth-admin-before-membership.sql',
    'synthetic-admin-profile-after-membership.sql',
    'assert-synthetic-admin-active.sql',
    'chat-media-upload-path-hardening.sql',
    'channel-avatar-catalog-reconstruction.test-only.sql',
    'channel-avatar-rls-runtime.test.sql',
    'direct-conversation-rpc.sql',
    'direct-conversation-rpc-eligibility-guard.sql',
    'synthetic-direct-chat-auth-before-membership.sql',
    'synthetic-direct-chat-profiles-after-membership.sql',
    'direct-conversation-eligibility-runtime.test.sql',
    'local-platform-prerequisites.assert.sql',
    'local-platform-postconditions.assert.sql'
  ];
  for (const name of requiredFixtures) await access(path.join(root, 'tests/staging/local-supabase/fixtures', name));
  for (const fixture of patchManifest.fixtures) await access(path.join(root, fixture.path));
  assert.equal(patchManifest.fixtures[0].path, 'tests/staging/local-supabase/fixtures/local-platform-prerequisites.assert.sql');
  assert.ok(patchManifest.fixtures.findIndex(item => item.path === 'tests/staging/local-supabase/fixtures/local-platform-postconditions.assert.sql') > patchManifest.fixtures.findIndex(item => item.path === 'tests/staging/local-supabase/fixtures/direct-conversation-eligibility-runtime.test.sql'));
  assert.ok(dag.nodes.find(node => node.id === 'legacy.messages').testSource.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'membership.syntax-fix').testSource.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'team.admin').testSource.some(source => source.includes('team_management_dashboard.sql')));
  assert.ok(dag.nodes.find(node => node.id === 'chat.channel-avatar-catalog-reconstruction')?.status === 'TEST_ONLY_PARTIAL_CATALOG_DERIVED_RECONSTRUCTION_RUNTIME_VERIFIED_LOCAL');
  assert.ok(dag.nodes.find(node => node.id === 'security.least-privilege-overlay')?.testSource.includes('tests/staging/local-supabase/fixtures/channel-avatar-rls-runtime.test.sql'));
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.direct-chat-auth-seed').source.some(source => source.includes('synthetic-direct-chat-auth-before-membership.sql')));
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.direct-chat-profiles').source.some(source => source.includes('synthetic-direct-chat-profiles-after-membership.sql')));
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.direct-chat-runtime').source.some(source => source.includes('direct-conversation-eligibility-runtime.test.sql')));
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.direct-chat-concurrency').source.some(source => source.includes('direct-conversation-concurrency.mjs')));
  assert.ok(dag.nodes.find(node => node.id === 'membership.official').testSource.some(source => source.includes('20261107152550_official_forever_membership_numbers_manual_verification.sql')));
  const mediaPolicy = await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/chat-media-upload-path-hardening.sql'), 'utf8');
  assert.match(mediaPolicy, /storage\.foldername\(name\)\)\[2\]\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.equal(patchManifest.execution.enabled, false);
  assert.equal(patchManifest.execution.productionAllowed, false);
  assert.equal(patchManifest.execution.cloudAllowed, false);
});
test('all pre-membership policy sources are ordered before the dynamic membership rewrite', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const inventory = await buildObjectInventory();
  const duplicatePaths = new Set(dag.duplicateProvenance.map(item => item.duplicate));
  const nodesBySource = new Map();
  for (const node of dag.nodes) for (const source of node.source ?? []) nodesBySource.set(source, node.id);
  const edges = new Map(dag.nodes.map(node => [node.id, []]));
  for (const [from, to] of dag.explicitEdges) if (edges.has(from)) edges.get(from).push(to);
  function reaches(start, target, seen = new Set()) {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return (edges.get(start) ?? []).some(next => reaches(next, target, seen));
  }
  const preMembershipPolicyFiles = inventory.files.filter(file =>
    file.policyDetails.length > 0 && file.sourceTimestamp && Number(file.sourceTimestamp) <= 20261107144109
  );
  for (const file of preMembershipPolicyFiles) {
    if (duplicatePaths.has(file.path)) continue;
    const nodeId = nodesBySource.get(file.path);
    assert.ok(nodeId, 'policy source missing from DAG: ' + file.path);
    assert.ok(reaches(nodeId, 'membership.base'), 'policy source is not ordered before membership rewrite: ' + file.path);
  }
});


test('every repository SQL source is mapped once or explicitly excluded as an identical duplicate', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const inventory = await buildObjectInventory();
  const mapped = new Set(dag.nodes.flatMap(node => node.source ?? []));
  const duplicateCopies = new Set(dag.duplicateProvenance.map(item => item.duplicate));
  for (const file of inventory.files) {
    assert.ok(mapped.has(file.path) || duplicateCopies.has(file.path), 'unmapped SQL source: ' + file.path);
  }
  for (const item of dag.duplicateProvenance) {
    assert.ok(mapped.has(item.canonicalTestSource), 'canonical duplicate source is not selected: ' + item.canonicalTestSource);
    assert.equal(mapped.has(item.duplicate), false, 'duplicate source must not be replayed: ' + item.duplicate);
  }
});


test('replay manifest is design-only, topologically aligned, and fail-closed', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const manifestPath = path.join(root, 'tests/staging/local-supabase/replay-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.mode, 'DESIGN_ONLY');
  assert.equal(manifest.status, 'BLOCKED');
  assert.equal(manifest.execution.enabled, false);
  assert.deepEqual(manifest.execution.files, []);
  assert.equal(manifest.execution.sqlExecuted, false);
  assert.equal(manifest.execution.cloudAllowed, false);
  assert.equal(manifest.execution.productionAllowed, false);
  assert.equal(manifest.sourceCoverage.testOnlySqlFixtures, manifest.sourceCoverage.testOnlySqlFixturePaths.length);
  assert.equal(new Set(manifest.sourceCoverage.testOnlySqlFixturePaths).size, manifest.sourceCoverage.testOnlySqlFixturePaths.length);
  for (const fixture of manifest.sourceCoverage.testOnlySqlFixturePaths) {
    assert.ok(fixture.startsWith('tests/staging/local-supabase/fixtures/'));
    assert.ok(fixture.endsWith('.sql'));
    await access(path.join(root, fixture));
  }
  assert.equal(manifest.sourceCoverage.testOnlySqlFixtures, 21);
  for (const fixture of [
    'tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql',
    'tests/staging/local-supabase/fixtures/direct-conversation-rpc-eligibility-guard.sql',
    'tests/staging/local-supabase/fixtures/direct-conversation-eligibility-runtime.test.sql',
    'tests/staging/local-supabase/fixtures/synthetic-direct-chat-auth-before-membership.sql',
    'tests/staging/local-supabase/fixtures/synthetic-direct-chat-profiles-after-membership.sql'
  ]) assert.ok(manifest.sourceCoverage.testOnlySqlFixturePaths.includes(fixture), 'SQL fixture missing from replay coverage: ' + fixture);
  assert.equal(manifest.blockers.find(item => item.id === 'DAG-002')?.severity, 'RESOLVED_FOR_LOCAL_REPLAY');
  for (const fixture of [
    'tests/staging/local-supabase/fixtures/local-platform-prerequisites.assert.sql',
    'tests/staging/local-supabase/fixtures/local-platform-postconditions.assert.sql'
  ]) assert.ok(manifest.sourceCoverage.testOnlySqlFixturePaths.includes(fixture));
  for (const id of ['DAG-007', 'DAG-008', 'DAG-010']) {
    assert.ok(dag.blockers.find(item => item.id === id)?.evidence?.some(path => path.includes('local-platform-')));
  }
  for (const id of ['DAG-014', 'DAG-015']) {
    assert.equal(dag.blockers.find(item => item.id === id)?.severity, 'RESOLVED_FOR_DISPOSABLE_LOCAL_RUNTIME');
    assert.equal(manifest.blockers.find(item => item.id === id)?.severity, 'RESOLVED_FOR_DISPOSABLE_LOCAL_RUNTIME');
  }
  const allNodes = [...dag.platformNodes, ...dag.nodes];
  const ids = allNodes.map(node => node.id);
  const indegree = new Map(ids.map(id => [id, 0]));
  const outgoing = new Map(ids.map(id => [id, []]));
  for (const [from, to] of dag.explicitEdges) { outgoing.get(from).push(to); indegree.set(to, indegree.get(to) + 1); }
  const queue = ids.filter(id => indegree.get(id) === 0);
  const expectedOrder = [];
  while (queue.length) { const id = queue.shift(); expectedOrder.push(id); for (const next of outgoing.get(id)) { indegree.set(next, indegree.get(next) - 1); if (indegree.get(next) === 0) queue.push(next); } }
  assert.equal(expectedOrder.length, ids.length);
  assert.deepEqual(manifest.candidateNodeOrder.map(node => node.nodeId), expectedOrder.filter(id => !id.startsWith('platform.')));
  const duplicateCopies = new Set(dag.duplicateProvenance.map(item => item.duplicate));
  const patchManifest = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/synthetic-fixture-patches.json'), 'utf8'));
  const patchedCanonicalSources = new Set(patchManifest.patches.map(item => item.sourcePath));
  const selected = manifest.candidateNodeOrder.flatMap(node => node.testSources);
  for (const fixture of manifest.sourceCoverage.testOnlySqlFixturePaths) {
    assert.ok(selected.includes(fixture), 'test-only SQL fixture is not in candidate replay order: ' + fixture);
  }
  const inventory = await buildObjectInventory();
  assert.equal(manifest.sourceCoverage.sqlFiles, inventory.files.length);
  assert.equal(manifest.sourceCoverage.mappedSources, inventory.files.length - duplicateCopies.size);
  assert.equal(manifest.sourceCoverage.mappedSourcesReplacedByFixtures, patchManifest.patches.length);
  assert.equal(manifest.sourceCoverage.executedMappedSources, manifest.sourceCoverage.mappedSources - patchManifest.patches.length);
  assert.equal(manifest.sourceCoverage.executedTestOnlySqlFixtures, manifest.sourceCoverage.testOnlySqlFixtures);
  assert.equal(manifest.sourceCoverage.executedSqlFiles, manifest.sourceCoverage.executedMappedSources + manifest.sourceCoverage.executedTestOnlySqlFixtures);
  assert.equal(new Set(selected.filter(source => source.endsWith('.sql'))).size, manifest.sourceCoverage.executedSqlFiles);
  for (const source of selected) await access(path.join(root, source));
  for (const file of inventory.files) {
    if (duplicateCopies.has(file.path) || patchedCanonicalSources.has(file.path)) continue;
    assert.ok(selected.includes(file.path), 'candidate replay source missing: ' + file.path);
  }
  for (const duplicate of duplicateCopies) assert.equal(selected.includes(duplicate), false);
  assert.ok(manifest.candidateNodeOrder.some(node => node.nodeId === 'chat.hardening' && node.blockedBy.includes('DAG-014')));
});


test('direct conversation RPC recovery instructions are read-only', async () => {
  const doc = await readFile(path.join(root, 'docs/RECOVER_DIRECT_CONVERSATION_RPC.md'), 'utf8');
  assert.match(doc, /pg_get_functiondef/);
  assert.match(doc, /get_or_create_direct_conversation_impl/);
  assert.match(doc, /read-only/i);
  assert.doesNotMatch(doc, /^\s*(insert|update|delete|create|alter|drop)\s+/im);
});

test('local pg_cron runtime probe is loopback-only and cleans up its unique job', async () => {
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/local-pg-cron-runtime.mjs'), 'utf8');
  for (const fragment of [
    'LOCAL_SUPABASE_DB_URL',
    "url.port !== '54322'",
    "url.username !== 'postgres'",
    "cron.schedule('",
    'cron.job_run_details',
    "result.startsWith('succeeded|')",
    'cron.unschedule(',
    'SELECT jobid::text FROM cron.job WHERE jobname=',
    'DELETE FROM cron.job_run_details',
    'Date.now() + 90000',
    'PGCONNECT_TIMEOUT',
    'PGOPTIONS'
  ]) assert.ok(runner.includes(fragment), 'missing local pg_cron probe safeguard: ' + fragment);
  assert.match(runner, /Refusing non-local database target/);
  assert.doesNotMatch(runner, /supabase\.co|SUPABASE_SERVICE_ROLE_KEY|service_role key/i);
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const node = dag.nodes.find(item => item.id === 'test-fixture.local-pg-cron-runtime');
  assert.ok(node);
  assert.equal(node.status, 'TEST_ONLY_LOCAL_PG_CRON_EXECUTION_PROBE_PASSED');
  assert.equal(node.blockedBy?.includes('DAG-008') ?? false, false);
  assert.equal(node.runtimeEvidence?.runId, 42863700280);
  assert.ok(node.requires.includes('test-fixture.local-platform-postflight'));
  assert.ok(dag.blockers.find(item => item.id === 'DAG-008').evidence.includes('tests/staging/local-supabase/local-pg-cron-runtime.mjs'));
  assert.equal(dag.executionAuthorized, false);
});
test('local platform preflight and postflight are read-only, ordered, and fail closed', async () => {
  const [preflight, postflight] = await Promise.all([
    readFile(path.join(root, 'tests/staging/local-supabase/fixtures/local-platform-prerequisites.assert.sql'), 'utf8'),
    readFile(path.join(root, 'tests/staging/local-supabase/fixtures/local-platform-postconditions.assert.sql'), 'utf8')
  ]);
  for (const sql of [preflight, postflight]) {
    assert.match(sql, /TEST ONLY/i);
    assert.doesNotMatch(sql, /^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/im);
  }
  assert.match(preflight, /auth\.users/);
  assert.match(preflight, /storage\.objects/);
  assert.match(preflight, /supabase_realtime/);
  assert.match(preflight, /extensions\.digest/);
  assert.match(preflight, /pg_available_extensions WHERE name = 'pg_cron'/);
  assert.match(postflight, /cron\.job/);
  assert.match(postflight, /purge-expired-chat-messages/);
  assert.match(postflight, /scheduler execution is verified by a separate runtime probe/i);
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const preNode = dag.nodes.find(node => node.id === 'test-fixture.local-platform-preflight');
  const postNode = dag.nodes.find(node => node.id === 'test-fixture.local-platform-postflight');
  assert.ok(preNode && postNode);
  assert.ok(dag.nodes.find(node => node.id === 'core.base').requires.includes(preNode.id));
  assert.ok(postNode.requires.includes('chat.workspaces'));
  assert.ok(postNode.requires.includes('chat.expiry-purge'));
  assert.ok(postNode.requires.includes(preNode.id));
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.safety.sqlExecutionEnabled, false);
});


test('least-privilege overlay is a test-only, locally validated, loopback-only SQL fixture', async () => {
  const overlay = await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql'), 'utf8');
  const assertion = await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/rls-least-privilege.assert.sql'), 'utf8');
  assert.match(overlay, /TEST-ONLY/i);
  assert.match(overlay, /app\.test_only_local_replay/i);
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs'), 'utf8');
  assert.match(runner, /url\.port !== '54322'/);
  assert.match(runner, /refusing non-local database target/i);
  assert.match(overlay, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM public, anon/i);
  assert.match(overlay, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/i);
  assert.match(assertion, /relrowsecurity/);
  assert.match(assertion, /is_active_member/);
  assert.match(assertion, /pg_default_acl/);
  const node = JSON.parse(await readFile(dagPath, 'utf8')).nodes.find(item => item.id === 'security.least-privilege-overlay');
  assert.ok(node);
  assert.equal(node.status, 'TEST_ONLY_PRIVILEGE_BASELINE_OVERLAY_RUNTIME_VALIDATED_LOCAL');
  assert.equal(node.runtimeEvidence?.runId, 42912189296);
  assert.ok(node.requires.includes('membership.final-format'));
  assert.equal(node.blockedBy?.includes('DAG-016') ?? false, false);
  assert.equal(JSON.parse(await readFile(dagPath, 'utf8')).executionAuthorized, false);
});


test('chat composer media types and reaction persistence constraints stay aligned', async () => {
  const appHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  const appModuleNames = ['00-bootstrap.js','10-conversations.js','20-message-interactions.js','30-receipts-rendering.js','40-message-runtime.js','50-group-management.js','60-personal-chat-settings.js','70-workspace.js'];
  const appModules = await Promise.all(appModuleNames.map(name => readFile(path.join(root, 'js', name), 'utf8')));
  const html = [appHtml, ...appModules].join('\n');
  const migration = await readFile(path.join(root, 'database/changes/20261110100000_chat_media_and_reaction_capabilities.sql'), 'utf8');
  for (const mime of [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]) {
    assert.ok(html.includes(mime), 'chat file picker is missing ' + mime);
    assert.ok(migration.includes(mime), 'Storage allow-list is missing ' + mime);
  }
  for (const reaction of ['like', 'heart', 'wow', 'pray', 'fire', 'celebrate']) {
    assert.match(html, new RegExp("type:\\s*['\\\"]" + reaction + "['\\\"]"));
    assert.ok(migration.includes("'" + reaction + "'"), 'database constraint is missing ' + reaction);
  }
  for (const mime of [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
  ]) {
    assert.ok(html.includes(mime), 'workspace document picker is missing ' + mime);
    assert.ok(migration.includes(mime), 'conversation-documents allow-list is missing ' + mime);
  }
  assert.match(html, /attachment_type\?\.startsWith\('video\/'\)/);
});


test('production baseline remains blocked until original migration provenance is resolved', async () => {
  const [dag, manifest] = await Promise.all([
    readFile(dagPath, 'utf8').then(JSON.parse),
    readFile(path.join(root, 'tests/staging/local-supabase/replay-manifest.json'), 'utf8').then(JSON.parse)
  ]);
  assert.equal(dag.status, 'BLOCKED');
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.safety.sqlExecutionEnabled, false);
  assert.equal(manifest.status, 'BLOCKED');
  assert.equal(manifest.execution.enabled, false);
  assert.equal(manifest.execution.cloudAllowed, false);
  assert.equal(manifest.execution.productionAllowed, false);
  assert.equal(dag.blockers.find(item => item.id === 'DAG-017')?.severity, 'BLOCKER');
  assert.equal(manifest.blockers.find(item => item.id === 'DAG-017')?.severity, 'BLOCKER');
  assert.equal(manifest.requiredSourceRecovery.length, 4);
  for (const item of manifest.requiredSourceRecovery) {
    assert.match(item.requirement, /2026110/);
    assert.ok(item.instructions);
    assert.ok(item.note);
  }
});
