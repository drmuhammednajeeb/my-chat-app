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

test('reviewed dependency graph is acyclic and preserves the direct-RPC blocker', async () => {
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
  assert.ok(dag.blockers.some(item => item.id === 'DAG-002' && item.severity === 'BLOCKER'));
  assert.ok(dag.nodes.some(node => node.id === 'chat.hardening' && node.requires.includes('UNRESOLVED:get_or_create_direct_conversation_impl(uuid)')));
});

test('test-only fixtures are present and canonical SQL remains outside the fixture tree', async () => {
  const dag = JSON.parse(await readFile(dagPath, 'utf8'));
  await access(path.join(root, 'tests/staging/local-supabase/fixtures/legacy-messages-compat.sql'));
  await access(path.join(root, 'tests/staging/local-supabase/fixtures/20261107152733_fix_official_membership_invite_duplicate_validation.sql'));
  assert.ok(dag.nodes.find(node => node.id === 'legacy.messages').source.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
  assert.ok(dag.nodes.find(node => node.id === 'membership.syntax-fix').source.some(source => source.startsWith('tests/staging/local-supabase/fixtures/')));
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
