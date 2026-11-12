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

test('professional message controls run after public-channel schema and reaction index prerequisites', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const pins = dag.nodes.find(node => node.id === 'chat.pins');
  assert.ok(pins.requires.includes('chat.channels-public'));
  assert.ok(pins.requires.includes('chat.reactions'));
  assert.ok(dag.explicitEdges.some(([from, to]) => from === 'chat.channels-public' && to === 'chat.pins'));
  assert.ok(dag.explicitEdges.some(([from, to]) => from === 'chat.reactions' && to === 'chat.pins'));
});

test('reviewed dependency graph is acyclic and preserves the direct-RPC runtime blocker', async () => {
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
  assert.ok(dag.blockers.some(item => item.id === 'DAG-014' && item.severity === 'BLOCKER'));
  assert.ok(dag.blockers.some(item => item.id === 'DAG-015' && item.severity === 'BLOCKER'));
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
    'direct-conversation-rpc.sql',
    'direct-conversation-rpc-eligibility-guard.sql',
    'synthetic-direct-chat-auth-before-membership.sql',
    'synthetic-direct-chat-profiles-after-membership.sql',
    'direct-conversation-eligibility-runtime.test.sql',
    'forward-direct-conversation-eligibility.assert.sql',
    'forward-hardening-postconditions.assert.sql',
    'local-platform-prerequisites.assert.sql',
    'local-platform-postconditions.assert.sql'
  ];
  for (const name of requiredFixtures) await access(path.join(root, 'tests/staging/local-supabase/fixtures', name));
  for (const fixture of patchManifest.fixtures) await access(path.join(root, fixture.path));
  assert.equal(patchManifest.fixtures[0].path, 'tests/staging/local-supabase/fixtures/local-platform-prerequisites.assert.sql');
  assert.ok(patchManifest.fixtures.findIndex(item => item.path === 'tests/staging/local-supabase/fixtures/local-platform-postconditions.assert.sql') > patchManifest.fixtures.findIndex(item => item.path === 'tests/staging/local-supabase/fixtures/direct-conversation-eligibility-runtime.test.sql'));
  assert.ok(dag.nodes.find(node => node.id === 'legacy.messages').testSource.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'membership.syntax-fix').testSource.includes('supabase/migrations/20261107152733_fix_official_membership_invite_duplicate_validation.sql'));
  assert.equal(dag.nodes.find(node => node.id === 'team.admin').source.length, 0);
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.admin-seed').testSource.includes('tests/staging/local-supabase/fixtures/seed-synthetic-team-admin.sql'));
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
  assert.equal(manifest.sourceCoverage.testOnlySqlFixtures, 19);
  for (const fixture of [
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
    assert.equal(dag.blockers.find(item => item.id === id)?.severity, 'BLOCKER');
    assert.equal(manifest.blockers.find(item => item.id === id)?.severity, 'BLOCKER');
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
  assert.equal(patchManifest.patches.length, 2);
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
  const canonicalSourceCounts = new Map();
  for (const node of dag.nodes) for (const source of node.source ?? []) if (source.startsWith('supabase/migrations/')) canonicalSourceCounts.set(source, (canonicalSourceCounts.get(source) ?? 0) + 1);
  assert.equal(canonicalSourceCounts.size, 66);
  assert.ok([...canonicalSourceCounts.values()].every(count => count === 1));
  assert.ok(manifest.candidateNodeOrder.some(node => node.nodeId === 'chat.hardening' && node.blockedBy.includes('DAG-014')));
});


test('direct conversation RPC recovery instructions are read-only', async () => {
  const doc = await readFile(path.join(root, 'docs/RECOVER_DIRECT_CONVERSATION_RPC.md'), 'utf8');
  assert.match(doc, /pg_get_functiondef/);
  assert.match(doc, /get_or_create_direct_conversation_impl/);
  assert.match(doc, /read-only/i);
  assert.doesNotMatch(doc, /^\s*(insert|update|delete|create|alter|drop)\s+/im);
});

test('forward RLS postconditions run after migrations without duplicate SQL selection', async () => {
  const dag = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/replay-manifest.json'), 'utf8'));
  const selectedSql = manifest.candidateNodeOrder.flatMap(node => (node.testSources ?? []).filter(source => source.endsWith('.sql')));
  assert.equal(selectedSql.length, new Set(selectedSql).size);
  const migrationIndex = manifest.candidateNodeOrder.findIndex(node => node.nodeId === 'security.active-membership-rls-forward');
  const assertionIndex = manifest.candidateNodeOrder.findIndex(node => node.nodeId === 'test-fixture.forward-hardening-postconditions');
  assert.ok(migrationIndex >= 0 && assertionIndex > migrationIndex);
  assert.ok(dag.nodes.find(node => node.id === 'test-fixture.forward-hardening-postconditions').requires.includes('security.active-membership-rls-forward'));
});

test('forward direct-conversation hardening is followed by runtime and concurrency probes', async () => {
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  assert.match(runner, /security\.direct-conversation-eligibility-forward/);
  assert.match(runner, /post-forward-eligibility-runtime/);
  assert.match(runner, /post-forward-concurrency/);
});

test('forward default-privilege migration leaves Supabase-managed role defaults untouched and fails closed on owned objects', async () => {
  const sql = await readFile(path.join(root, 'supabase/migrations/20261112160002_revoke_unsafe_public_default_privileges.sql'), 'utf8');
  assert.doesNotMatch(sql, /alter default privileges for role supabase_admin/i);
  assert.match(sql, /supabase_admin owns public-schema objects/);
  assert.match(sql, /alter default privileges for role postgres/i);
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
  assert.equal(node.status, 'TEST_ONLY_LOCAL_PG_CRON_EXECUTION_PROBE_NOT_EXECUTED');
  assert.ok(node.blockedBy.includes('DAG-008'));
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
  assert.match(postflight, /scheduler execution still requires a separate runtime check/i);
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


test('least-privilege overlay is a final, blocked, loopback-only SQL fixture', async () => {
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
  assert.equal(node.status, 'TEST_ONLY_PRIVILEGE_BASELINE_OVERLAY_RUNTIME_VALIDATION_BLOCKED');
  assert.ok(node.requires.includes('membership.final-format'));
  assert.ok(node.blockedBy.includes('DAG-016'));
  assert.equal(JSON.parse(await readFile(dagPath, 'utf8')).executionAuthorized, false);
});


test('chat composer media allowlists are checked against the archived proposal, not represented as applied production SQL', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const migration = await readFile(path.join(root, 'database/archive/unapplied/20261110100000_chat_media_and_reaction_capabilities.sql'), 'utf8');
  const reactionSchema = await readFile(path.join(root, 'supabase/migrations/20261106125643_message_reactions_and_realtime.sql'), 'utf8');
  const reactionModule = await readFile(path.join(root, 'modules/message-reactions.js'), 'utf8');
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
  const archiveManifest = JSON.parse(await readFile(path.join(root, 'database/archive/manifest.json'), 'utf8'));
  assert.ok(archiveManifest.sqlFiles.some(file => file.path === 'database/archive/unapplied/20261110100000_chat_media_and_reaction_capabilities.sql' && file.classification === 'unapplied-proposal'));
  assert.ok(html.includes('modules/message-reactions.js'));
  assert.ok(html.includes('modules/message-reactions.css'));
  assert.match(reactionModule, /type: "like"/);
  assert.match(reactionModule, /type: "heart"/);
  assert.ok(reactionSchema.includes("'like'"));
  assert.ok(reactionSchema.includes("'heart'"));
  assert.doesNotMatch(reactionModule, /type: "(wow|pray|fire|celebrate)"/);
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
  assert.ok(html.includes("attachment_type?.startsWith('video/')"));
});


test('four forward hardening migrations remain outside the production ledger and retain explicit blockers', async () => {
  const registry = JSON.parse(await readFile(path.join(root, 'supabase/migrations/source-registry.json'), 'utf8'));
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  assert.equal(registry.productionMigrations.length, 62);
  assert.equal(registry.forwardMigrations.length, 4);
  const expected = new Map([
    ['20261112160000_harden_direct_conversation_eligibility.sql', ['DAG-014', 'DAG-015']],
    ['20261112160001_harden_chat_media_upload_ownership.sql', ['DAG-013']],
    ['20261112160002_revoke_unsafe_public_default_privileges.sql', ['DAG-016']],
    ['20261112160003_enforce_active_membership_rls.sql', ['DAG-016']]
  ]);
  for (const [name, blockers] of expected) {
    const path = 'supabase/migrations/' + name;
    const node = dag.nodes.find(item => item.source?.includes(path));
    assert.ok(node, 'forward migration missing from DAG: ' + name);
    assert.deepEqual(node.blockedBy, blockers);
    assert.equal(registry.forwardMigrations.some(item => item.path === path && item.status === 'FORWARD_RECONCILIATION_NOT_APPLIED'), true);
  }
  assert.equal(dag.safety.forwardMigrationExecutionAuthorized, false);
});


test('post-forward runtime assertions are ordered after their matching security migrations', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/replay-manifest.json'), 'utf8'));
  const direct = dag.nodes.find(item => item.id === 'test-fixture.forward-direct-conversation-eligibility');
  const hardening = dag.nodes.find(item => item.id === 'test-fixture.forward-hardening-postconditions');
  assert.ok(direct && hardening);
  assert.ok(direct.requires.includes('security.direct-conversation-eligibility-forward'));
  assert.ok(hardening.requires.includes('security.active-membership-rls-forward'));
  assert.ok(dag.explicitEdges.some(([from, to]) => from === direct.id && to === 'test-fixture.direct-chat-concurrency'));
  for (const path of [
    'tests/staging/local-supabase/fixtures/forward-direct-conversation-eligibility.assert.sql',
    'tests/staging/local-supabase/fixtures/forward-hardening-postconditions.assert.sql'
  ]) assert.ok(manifest.sourceCoverage.testOnlySqlFixturePaths.includes(path));
  assert.equal(manifest.sourceCoverage.executedTestOnlySqlFixtures, 19);
  assert.equal(manifest.sourceCoverage.executedSqlFiles, 83);
});
