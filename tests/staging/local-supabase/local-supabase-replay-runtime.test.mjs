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
    'allowedDatabasePorts = new Set([\'54322\', \'54329\'])',
    'LOCAL_SUPABASE_EXPECTED_DB_PORT',
    'url.port !== expectedDatabasePort',
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
  for (const token of [
    'workflow_dispatch',
    'supabase/setup-cli@v1',
    'version: 3.0.0',
    'supabase init',
    'supabase start --exclude',
    'major_version = 17',
    'port = 54329',
    'LOCAL_SUPABASE_EXPECTED_DB_PORT: "54329"',
    'LOCAL_SUPABASE_DB_URL',
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    'local-supabase-replay-runtime.mjs',
    'supabase stop'
  ]) assert.ok(workflow.includes(token), 'missing isolated runtime workflow contract: ' + token);
  assert.doesNotMatch(workflow, /supabase link|--remote|--linked|SUPABASE_ACCESS_TOKEN/i);
});
