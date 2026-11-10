#!/usr/bin/env node
// Executes the reviewed SQL candidate order only against a disposable local Supabase stack.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = path.join(ROOT, 'tests/staging/local-supabase/replay-manifest.json');
const dagPath = path.join(ROOT, 'tests/staging/local-supabase/reviewed-dependency-dag.json');

function fail(message) {
  console.error('LOCAL_SUPABASE_REPLAY_BLOCKED=' + message);
  process.exit(1);
}
function run(command, args, env, label) {
  console.log('LOCAL_RUNTIME_STEP=' + label);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    stdio: 'inherit',
    timeout: 10 * 60 * 1000
  });
  if (result.error) fail(label + ' could not start: ' + result.error.message);
  if (result.status !== 0) fail(label + ' failed with exit code ' + result.status);
}

if (process.env.ALLOW_DISPOSABLE_LOCAL_REPLAY !== '1') {
  fail('set ALLOW_DISPOSABLE_LOCAL_REPLAY=1 only inside the disposable local Supabase job');
}
for (const forbidden of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID']) {
  if (process.env[forbidden]) fail('cloud-linked environment variable is present: ' + forbidden);
}
const raw = process.env.LOCAL_SUPABASE_DB_URL;
if (!raw) fail('LOCAL_SUPABASE_DB_URL is required');
let url;
try { url = new URL(raw); } catch { fail('invalid LOCAL_SUPABASE_DB_URL'); }
const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || url.port !== '54322'
  || url.username !== 'postgres'
  || url.pathname !== '/postgres'
  || url.search || url.hash) {
  fail('refusing non-local database target; expected postgres@loopback:54322/postgres');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const dag = JSON.parse(fs.readFileSync(dagPath, 'utf8'));
if (manifest.mode !== 'DESIGN_ONLY'
  || manifest.status !== 'BLOCKED'
  || manifest.execution?.enabled !== false
  || manifest.execution?.cloudAllowed !== false
  || manifest.execution?.productionAllowed !== false
  || manifest.execution?.sqlExecuted !== false
  || manifest.execution?.localStackStarted !== false
  || manifest.execution?.networkEgressAllowed !== false
  || dag.executionAuthorized !== false
  || dag.safety?.sqlExecutionEnabled !== false
  || dag.safety?.supabaseStartupAuthorized !== false
  || dag.safety?.cloudConnectionsAllowed !== false
  || dag.safety?.productionDataAllowed !== false
  || dag.safety?.canonicalSqlMutationAllowed !== false
  || dag.safety?.costBearingResourcesAllowed !== false) {
  fail('the reviewed source manifests no longer match the fail-closed local-only contract');
}

const allNodes = [...dag.platformNodes, ...dag.nodes];
const ids = allNodes.map(node => node.id);
const indegree = new Map(ids.map(id => [id, 0]));
const outgoing = new Map(ids.map(id => [id, []]));
for (const [from, to] of dag.explicitEdges) {
  if (!outgoing.has(from) || !indegree.has(to)) fail('DAG edge references an unknown node');
  outgoing.get(from).push(to);
  indegree.set(to, indegree.get(to) + 1);
}
const queue = ids.filter(id => indegree.get(id) === 0);
const expectedOrder = [];
while (queue.length) {
  const id = queue.shift();
  expectedOrder.push(id);
  for (const next of outgoing.get(id)) {
    indegree.set(next, indegree.get(next) - 1);
    if (indegree.get(next) === 0) queue.push(next);
  }
}
const expectedAppOrder = expectedOrder.filter(id => !id.startsWith('platform.'));
const actualAppOrder = manifest.candidateNodeOrder.map(node => node.nodeId);
if (expectedOrder.length !== ids.length || JSON.stringify(expectedAppOrder) !== JSON.stringify(actualAppOrder)) {
  fail('candidate replay order is not the exact reviewed topological DAG order');
}
if (actualAppOrder[0] !== 'test-fixture.local-platform-preflight') {
  fail('read-only Supabase platform preflight must run before every application SQL file');
}

const env = {
  PATH: process.env.PATH ?? '',
  LOCAL_SUPABASE_DB_URL: raw,
  PGCONNECT_TIMEOUT: '5',
  PGOPTIONS: '-c statement_timeout=60s -c lock_timeout=10s'
};
const seenSql = new Set();
for (const node of manifest.candidateNodeOrder) {
  if (node.nodeId === 'security.least-privilege-overlay') {
    for (const relative of node.testSources.filter(item => item.endsWith('.sql'))) {
      if (seenSql.has(relative)) fail('SQL source is selected more than once: ' + relative);
      const absolute = path.resolve(ROOT, relative);
      if (!absolute.startsWith(ROOT + path.sep) || !fs.existsSync(absolute)) fail('SQL source is missing or escapes the repository: ' + relative);
      seenSql.add(relative);
    }
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs')
    ], { ...env, ALLOW_DISPOSABLE_LOCAL_REPLAY: '1' }, node.nodeId);
    continue;
  }

  for (const relative of node.testSources ?? []) {
    if (!relative.endsWith('.sql')) continue;
    if (seenSql.has(relative)) fail('SQL source is selected more than once: ' + relative);
    seenSql.add(relative);
    const absolute = path.resolve(ROOT, relative);
    if (!absolute.startsWith(ROOT + path.sep) || !fs.existsSync(absolute)) {
      fail('SQL source is missing or escapes the repository: ' + relative);
    }
    run('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file', absolute, raw], env, node.nodeId + ':' + relative);
  }

  if (node.nodeId === 'test-fixture.direct-chat-concurrency') {
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs')
    ], env, node.nodeId);
  }
  if (node.nodeId === 'test-fixture.local-pg-cron-runtime') {
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/local-pg-cron-runtime.mjs')
    ], env, node.nodeId);
  }
}

run(process.execPath, [
  path.join(ROOT, 'tests/staging/local-supabase/local-storage-rls-runtime.mjs')
], {
  ...env,
  LOCAL_SUPABASE_URL: process.env.LOCAL_SUPABASE_URL ?? '',
  LOCAL_SUPABASE_ANON_KEY: process.env.LOCAL_SUPABASE_ANON_KEY ?? '',
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? ''
}, 'storage-api-rls-runtime');

const expectedSqlCount = manifest.sourceCoverage.mappedSources + manifest.sourceCoverage.testOnlySqlFixtures;
if (seenSql.size !== expectedSqlCount) fail('executed SQL coverage mismatch: expected ' + expectedSqlCount + ', found ' + seenSql.size);
console.log('LOCAL_SUPABASE_REPLAY_RUNTIME=PASSED');
console.log('LOCAL_SUPABASE_SQL_FILES_EXECUTED=' + seenSql.size);
