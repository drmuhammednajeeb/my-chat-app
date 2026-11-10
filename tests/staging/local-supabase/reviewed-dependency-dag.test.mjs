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
    'local-platform-prerequisites.assert.sql',
    'local-platform-postconditions.assert.sql'
  ];
  for (const name of requiredFixtures) await access(path.join(root, 'tests/staging/local-supabase/fixtures', name));
  for (const fixture of patchManifest.fixtures) await access(path.join(root, fixture.path));
  assert.ok(dag.nodes.find(node => node.id === 'legacy.messages').testSource.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'membership.syntax-fix').testSource.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'team.admin').testSource.some(source => source.includes('team_management_dashboard.sql')));
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
  assert.equal(manifest.sourceCoverage.testOnlySqlFixtures, 16);
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
  const inventory = await buildObjectInventory();
  assert.equal(manifest.sourceCoverage.sqlFiles, inventory.files.length);
  assert.equal(manifest.sourceCoverage.mappedSources, inventory.files.length - duplicateCopies.size);
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
