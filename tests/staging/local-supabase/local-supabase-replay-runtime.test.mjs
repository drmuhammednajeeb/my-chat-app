import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('local replay runtime is explicitly authorized and loopback-only', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  for (const token of [
    'ALLOW_DISPOSABLE_LOCAL_REPLAY',
    "url.port !== '54322'",
    "url.username !== 'postgres'",
    "url.pathname !== '/postgres'",
    "'127.0.0.1'",
    "'localhost'",
    "'::1'",
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_PROJECT_ID',
    "manifest.mode !== 'DESIGN_ONLY'",
    'manifest.execution?.enabled !== false',
    'manifest.execution?.localStackStarted !== false',
    'manifest.execution?.networkEgressAllowed !== false',
    'dag.executionAuthorized !== false',
    'dag.safety?.sqlExecutionEnabled !== false',
    'dag.safety?.supabaseStartupAuthorized !== false',
    'dag.safety?.costBearingResourcesAllowed !== false',
    'candidate replay order is not the exact reviewed topological DAG order',
    'test-fixture.local-platform-preflight',
    'local-rls-least-privilege-runtime.mjs',
    'direct-conversation-concurrency.mjs',
    'local-pg-cron-runtime.mjs',
    'local-storage-rls-runtime.mjs',
    'expectedSqlCount',
    'synthetic-fixture-patches.json',
    'patchManifest.patches.length',
    'executedSqlFiles',
    'mappedSourcesReplacedByFixtures',
    'LOCAL_SUPABASE_REPLAY_RUNTIME=PASSED',
    '/auth/v1/admin/users',
    'syntheticAuthIds[user.key] = data.id',
    'LOCAL_SYNTHETIC_AUTH_USERS_JSON',
    'identityArgs'
  ]) assert.ok(source.includes(token), 'missing replay safety/coverage token: ' + token);
  assert.match(source, /refusing non-local database target/i);
  assert.doesNotMatch(source, /supabase\.co|--remote|--linked/i);
});

test('runtime workflow uses an isolated temporary project and pinned local CLI only', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/disposable-local-supabase-runtime.yml'), 'utf8');
  const runtimeRunner = await readFile(path.join(root, 'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  for (const token of [
    'workflow_dispatch',
    'supabase/setup-cli@1dedf2c611547ede7232d26866dd3c56ab903bbb',
    'version: 3.0.0',
    'supabase init',
    'supabase start --exclude',
    'postgres-meta,inbucket',
    'SUPABASE_CONTAINER_EGRESS_ISOLATION=ENFORCED',
    'playwright@1.65.0',
    'DOCKER-USER',
    'SUPABASE_EGRESS_GUARD',
    'iptables',
    'major_version = 17',
    'LOCAL_SUPABASE_DB_URL',
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    'local-supabase-replay-runtime.mjs',
    'supabase stop'
  ]) assert.ok(workflow.includes(token), 'missing isolated runtime workflow contract: ' + token);
  assert.doesNotMatch(workflow, /supabase link|--remote|--linked|SUPABASE_ACCESS_TOKEN/i);
  assert.ok(runtimeRunner.includes('local-app-e2e.mjs'), 'runtime runner must invoke the browser E2E against local Supabase');
  assert.ok(runtimeRunner.includes('local-api-load-runtime.mjs'), 'runtime runner must invoke the bounded API load probe');
});

test('browser E2E rewrites the app to a loopback-only synthetic Supabase target', async () => {
  const script = await readFile(path.join(root, 'tests/staging/local-supabase/local-app-e2e.mjs'), 'utf8');
  assert.match(script, /requireLoopbackApi/);
  assert.match(script, /url\.port, '54321'/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /direct-a@bizmindmakers\.test/);
  assert.match(script, /direct-b@bizmindmakers\.test/);
  assert.match(script, /cdn\.jsdelivr\.net/);
  assert.match(script, /unpkg\.com/);
  assert.match(script, /LOCAL_APP_E2E_RECIPIENT_READ=PASSED/);
  assert.match(script, /LOCAL_APP_E2E_RELOAD_PERSISTENCE=PASSED/);
});

test('API load probe is loopback-only, bounded, and read-only', async () => {
  const script = await readFile(path.join(root, 'tests/staging/local-supabase/local-api-load-runtime.mjs'), 'utf8');
  assert.match(script, /ALLOW_DISPOSABLE_LOCAL_REPLAY/);
  assert.match(script, /api\.port, '54321'/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /concurrency = 8/);
  assert.match(script, /requestsPerWorker = 25/);
  assert.match(script, /AbortSignal\.timeout/);
  assert.match(script, /LOCAL_API_LOAD_P95_MS=/);
  assert.match(script, /LOCAL_API_LOAD=PASSED/);
  assert.doesNotMatch(script, /https:\/\/[^\s'"]+\.supabase\.co/i);
});
