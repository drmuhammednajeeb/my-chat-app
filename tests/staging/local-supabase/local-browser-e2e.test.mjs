import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => readFile(path.join(root, file), 'utf8');

test('application test endpoint override is loopback-only and keeps production defaults', async () => {
  const app = await read('app.js');
  assert.match(app, /const __localSupabaseTestConfig=window\.__BIZMIND_LOCAL_SUPABASE_TEST_CONFIG__\|\|null/);
  assert.match(app, /let SUPABASE_URL='https:\/\/lvkeohpuucuklagvwpnq\.supabase\.co'/);
  assert.match(app, /let SUPABASE_ANON_KEY='sb_publishable_/);
  assert.match(app, /location\.protocol!=='http:'/);
  assert.match(app, /\['127\.0\.0\.1','localhost','::1'\]\.includes\(host\)/);
  assert.match(app, /endpoint\.port!=='54321'/);
  assert.match(app, /endpoint\.protocol!=='http:'/);
  assert.match(app, /endpoint\.pathname!=='\/'/);
  assert.match(app, /SUPABASE_URL=endpoint\.origin/);
  assert.match(app, /SUPABASE_ANON_KEY=__localSupabaseTestConfig\.anonKey/);
});

test('full browser E2E requires local-only endpoints and two synthetic authenticated users', async () => {
  const runner = await read('tests/staging/local-supabase/local-browser-e2e.mjs');
  for (const token of [
    "api.port !== '54321'",
    "api.protocol !== 'http:'",
    "'127.0.0.1'",
    "'localhost'",
    "'::1'",
    'LOCAL_SYNTHETIC_AUTH_PASSWORD',
    'LOCAL_SYNTHETIC_AUTH_USERS_JSON',
    '/auth/v1/token?grant_type=password',
    '/rest/v1/rpc/get_or_create_direct_conversation',
    "page.locator('#authSubmit').click()",
    "page.locator('#messageInput').fill(message)",
    "page.locator('#sendBtn').click()",
    "textContent?.trim() === 'متصل'",
    "      null,",
    "      { timeout: 30000 }",
    "status, 'SUBSCRIBED'",
    "lastEvent, 'INSERT'",
    'REALTIME_PUBLICATION_CHAT_MESSAGES=true',
    'pg_publication_tables',
    '__BIZMIND_E2E_REALTIME_OBSERVER__',
    'unfiltered authenticated Realtime diagnostic observer',
    "observer?.event?.conversationId, conversation",
    'BROWSER_E2E_CROSS_SESSION_DELIVERY=PASSED',
    'BROWSER_E2E_MESSAGE_PERSISTENCE=PASSED',
    'BROWSER_E2E_PRODUCTION_REQUESTS=0'
  ]) assert.ok(runner.includes(token), 'missing browser E2E requirement: ' + token);
  assert.match(runner, /Refusing non-local E2E API target/);
  assert.match(runner, /productionRequests/);
  assert.match(runner, /pageErrors/);
  assert.doesNotMatch(runner, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('disposable replay invokes browser E2E before destroying local Supabase', async () => {
  const replay = await read('tests/staging/local-supabase/local-supabase-replay-runtime.mjs');
  assert.ok(replay.includes("local-browser-e2e.mjs"));
  assert.ok(replay.indexOf("local-browser-e2e.mjs") > replay.indexOf("local-storage-rls-runtime.mjs"));
  assert.ok(replay.indexOf("local-browser-e2e.mjs") < replay.indexOf("const patchManifest"));
  const workflow = await read('.github/workflows/disposable-local-supabase-runtime.yml');
  assert.match(workflow, /playwright@1\.56\.1/);
  assert.match(workflow, /playwright install --with-deps chromium/);
});


test('bounded message pressure probe is local-only and verifies all persisted writes', async () => {
  const runner = await read('tests/staging/local-supabase/local-message-load.mjs');
  for (const token of [
    "db.port !== '54322'",
    "db.username !== 'postgres'",
    "db.pathname !== '/postgres'",
    'const batchSize = 40, batches = 3, expected = batchSize * batches',
    'Promise.allSettled(tasks)',
    'MESSAGE_LOAD_PERSISTED=',
    'MESSAGE_LOAD_UNIQUE_IDS=',
    'MESSAGE_LOAD_P50_CLIENT_MS=',
    'MESSAGE_LOAD_P95_CLIENT_MS=',
    'MESSAGE_LOAD_MAX_CLIENT_MS=',
    'MESSAGE_LOAD_RESULT=PASSED'
  ]) assert.ok(runner.includes(token), 'missing message pressure check: ' + token);
  assert.match(runner, /Refusing non-local message load target/);
  const replay = await read('tests/staging/local-supabase/local-supabase-replay-runtime.mjs');
  assert.ok(replay.includes("local-message-load.mjs"));
  assert.ok(replay.indexOf("local-message-load.mjs") > replay.indexOf("local-browser-e2e.mjs"));
});
