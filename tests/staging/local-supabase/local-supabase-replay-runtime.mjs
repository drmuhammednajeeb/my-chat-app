#!/usr/bin/env node
// Executes the reviewed SQL candidate order only against a disposable local Supabase stack.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
let syntheticAuthPassword = null;
let syntheticAuthIds = null;

async function provisionSyntheticDirectChatAuthUsers() {
  const rawApi = process.env.LOCAL_SUPABASE_URL;
  const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!rawApi || !serviceKey) fail('local Supabase API URL and service key are required for synthetic Auth provisioning');
  let api;
  try { api = new URL(rawApi); } catch { fail('invalid LOCAL_SUPABASE_URL for synthetic Auth provisioning'); }
  const apiHost = api.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (api.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '::1'].includes(apiHost)
    || api.port !== '54321'
    || api.pathname !== '/'
    || api.username || api.password || api.search || api.hash) {
    fail('refusing non-local Auth provisioning target; expected http://loopback:54321');
  }

  syntheticAuthPassword = 'RlsRuntime-' + randomBytes(24).toString('hex') + '!aA9';
  syntheticAuthIds = {};
  const users = [
    { key: 'direct_a', email: 'direct-a@bizmindmakers.test', number: '971001000002', verified: true, confirmed: true, username: 'direct_a', displayName: 'Direct Test A' },
    { key: 'direct_b', email: 'direct-b@bizmindmakers.test', number: '971001000003', verified: true, confirmed: true, username: 'direct_b', displayName: 'Direct Test B' },
    { key: 'direct_suspended', email: 'direct-suspended@bizmindmakers.test', number: '971001000004', verified: true, confirmed: true, username: 'direct_suspended', displayName: 'Direct Test Suspended' },
    { key: 'direct_unverified', email: 'direct-unverified@bizmindmakers.test', number: '971001000005', verified: false, confirmed: true, username: 'direct_unverified', displayName: 'Direct Test Unverified' },
    { key: 'direct_unconfirmed', email: 'direct-unconfirmed@bizmindmakers.test', number: '971001000006', verified: true, confirmed: false, username: 'direct_unconfirmed', displayName: 'Direct Test Unconfirmed' },
    { key: 'direct_missing_profile', email: 'direct-missing-profile@bizmindmakers.test', number: '971001000007', verified: true, confirmed: true, username: 'direct_missing_profile', displayName: 'Direct Test Missing Profile' }
  ];

  for (const user of users) {
    const response = await fetch(new URL('/auth/v1/admin/users', api.origin), {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        password: syntheticAuthPassword,
        email_confirm: user.confirmed,
        app_metadata: {
          provider: 'email',
          providers: ['email'],
          membership_number: user.number,
          membership_number_verified: user.verified
        },
        user_metadata: {
          username: user.username,
          display_name: user.displayName
        }
      }),
      signal: AbortSignal.timeout(20000)
    });
    const bodyText = await response.text();
    let data = null;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { data = null; }
    if (!response.ok) {
      fail('GoTrue Admin API could not provision synthetic user ' + user.email
        + ' (HTTP ' + response.status + '): ' + bodyText.slice(0, 300));
    }
    if (typeof data?.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)) {
      fail('GoTrue Admin API returned an invalid identity for ' + user.email);
    }
    syntheticAuthIds[user.key] = data.id;
    console.log('LOCAL_AUTH_FIXTURE_PROVISIONED=' + user.email);
  }
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
const allowedDatabasePorts = new Set(['54322', '54329']);
const expectedDatabasePort = process.env.LOCAL_SUPABASE_EXPECTED_DB_PORT || '54322';
if (!allowedDatabasePorts.has(expectedDatabasePort)) fail('LOCAL_SUPABASE_EXPECTED_DB_PORT is not allowlisted');
let url;
try { url = new URL(raw); } catch { fail('invalid LOCAL_SUPABASE_DB_URL'); }
const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || url.port !== expectedDatabasePort
  || url.username !== 'postgres'
  || url.pathname !== '/postgres'
  || url.search || url.hash) {
  fail('refusing non-local database target; expected postgres@loopback:' + expectedDatabasePort + '/postgres');
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
  LOCAL_SUPABASE_EXPECTED_DB_PORT: expectedDatabasePort,
  PGCONNECT_TIMEOUT: '5',
  PGOPTIONS: '-c app.test_only_local_replay=enabled -c statement_timeout=60s -c lock_timeout=10s'
};
const seenSql = new Set();
let postForwardConcurrencyExecuted = false;
for (const node of manifest.candidateNodeOrder) {
  if (node.nodeId === 'test-fixture.direct-chat-auth-seed') {
    await provisionSyntheticDirectChatAuthUsers();
  }
  if (node.nodeId === 'security.least-privilege-overlay') {
    for (const relative of node.testSources.filter(item => item.endsWith('.sql'))) {
      if (seenSql.has(relative)) fail('SQL source is selected more than once: ' + relative);
      const absolute = path.resolve(ROOT, relative);
      if (!absolute.startsWith(ROOT + path.sep) || !fs.existsSync(absolute)) fail('SQL source is missing or escapes the repository: ' + relative);
      seenSql.add(relative);
    }
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs')
    ], { ...env, ALLOW_DISPOSABLE_LOCAL_REPLAY: '1', LOCAL_SYNTHETIC_AUTH_USERS_JSON: JSON.stringify(syntheticAuthIds ?? {}) }, node.nodeId);
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
    const identityArgs = syntheticAuthIds ? Object.entries(syntheticAuthIds).map(([key, id]) => '--set=' + key + '_id=' + id) : [];
    run('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', ...identityArgs, '--file', absolute, raw], env, node.nodeId + ':' + relative);
  }

  if (node.nodeId === 'test-fixture.direct-chat-concurrency' && !postForwardConcurrencyExecuted) {
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs')
    ], { ...env, LOCAL_SYNTHETIC_AUTH_USERS_JSON: JSON.stringify(syntheticAuthIds ?? {}) }, node.nodeId);
  }
  if (node.nodeId === 'security.direct-conversation-eligibility-forward') {
    const identityArgs = syntheticAuthIds
      ? Object.entries(syntheticAuthIds).map(([key, id]) => '--set=' + key + '_id=' + id)
      : [];
    run('psql', [
      '--no-psqlrc', '--set=ON_ERROR_STOP=1', ...identityArgs,
      '--file', path.join(ROOT, 'tests/staging/local-supabase/fixtures/direct-conversation-eligibility-runtime.test.sql'), raw
    ], env, node.nodeId + ':post-forward-eligibility-runtime');
    run(process.execPath, [
      path.join(ROOT, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs')
    ], { ...env, LOCAL_SYNTHETIC_AUTH_USERS_JSON: JSON.stringify(syntheticAuthIds ?? {}) }, node.nodeId + ':post-forward-concurrency');
    postForwardConcurrencyExecuted = true;
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
  LOCAL_SYNTHETIC_AUTH_PASSWORD: syntheticAuthPassword ?? '',
  LOCAL_SYNTHETIC_AUTH_USERS_JSON: JSON.stringify(syntheticAuthIds ?? {})
}, 'storage-api-rls-runtime');

const patchManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/staging/local-supabase/fixtures/synthetic-fixture-patches.json'), 'utf8'));
if (patchManifest.mode !== 'TEST_COPY_ONLY' || !Array.isArray(patchManifest.patches)) {
  fail('synthetic fixture patch manifest is invalid');
}
const replacedSourcePaths = new Set(patchManifest.patches.map(item => item.sourcePath));
if (replacedSourcePaths.size !== patchManifest.patches.length
  || replacedSourcePaths.size !== manifest.sourceCoverage.mappedSourcesReplacedByFixtures) {
  fail('mapped-source replacement count does not match the reviewed fixture patch manifest');
}
for (const patch of patchManifest.patches) {
  const sourcePath = path.resolve(ROOT, patch.sourcePath);
  const fixturePath = path.resolve(ROOT, patch.testCopyPath);
  if (!sourcePath.startsWith(ROOT + path.sep) || !fixturePath.startsWith(ROOT + path.sep)
    || !fs.existsSync(sourcePath) || !fs.existsSync(fixturePath)
    || !manifest.sourceCoverage.testOnlySqlFixturePaths.includes(patch.testCopyPath)) {
    fail('mapped-source test replacement is missing or not registered: ' + patch.sourcePath);
  }
}
const expectedSqlCount = manifest.sourceCoverage.executedSqlFiles;
if (expectedSqlCount !== manifest.sourceCoverage.executedMappedSources + manifest.sourceCoverage.executedTestOnlySqlFixtures
  || expectedSqlCount !== manifest.sourceCoverage.mappedSources - replacedSourcePaths.size + manifest.sourceCoverage.testOnlySqlFixtures) {
  fail('declared executed SQL coverage does not reconcile with mapped-source replacements');
}
if (seenSql.size !== expectedSqlCount) fail('executed SQL coverage mismatch: expected ' + expectedSqlCount + ', found ' + seenSql.size);
console.log('LOCAL_SUPABASE_REPLAY_RUNTIME=PASSED');
console.log('LOCAL_SUPABASE_SQL_SOURCE_REPLACEMENTS=' + replacedSourcePaths.size);
console.log('LOCAL_SUPABASE_SQL_FILES_EXECUTED=' + seenSql.size);
