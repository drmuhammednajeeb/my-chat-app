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
    'dag.executionAuthorized !== false',
    'candidate replay order is not the exact reviewed topological DAG order',
    'test-fixture.local-platform-preflight',
    'local-rls-least-privilege-runtime.mjs',
    'direct-conversation-concurrency.mjs',
    'local-pg-cron-runtime.mjs',
    'local-storage-rls-runtime.mjs',
    'LOCAL_SUPABASE_REPLAY_RUNTIME=PASSED'
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
    'LOCAL_SUPABASE_DB_URL',
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    'local-supabase-replay-runtime.mjs',
    'supabase stop'
  ]) assert.ok(workflow.includes(token), 'missing isolated runtime workflow contract: ' + token);
  assert.doesNotMatch(workflow, /supabase link|--remote|--linked|SUPABASE_ACCESS_TOKEN/i);
});
