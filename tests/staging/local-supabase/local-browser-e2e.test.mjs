import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => readFile(path.join(root, file), 'utf8');

test('application test endpoint override is loopback-only and preserves production runtime config', async () => {
  const app = await read('index.html');
  assert.match(app, /const __localSupabaseTestConfig=window\.__BIZMIND_LOCAL_SUPABASE_TEST_CONFIG__\|\|null/);
  assert.match(app, /location\.protocol!=='http:'/);
  assert.match(app, /isLoopbackHost\(pageHost\)/);
  assert.match(app, /localApi\.port!==expectedPort/);
  assert.match(app, /window\.BizmindRuntimeConfig\.isPublicAnonKey/);
  assert.match(app, /__deploymentConfig=window\.BizmindRuntimeConfig\.resolve/);
  assert.match(app, /p\.new\?\.conversation_id!==id\|\|state\.active\?\.id!==id/);
  assert.match(app, /state\.diagnostics\.lastRealtimeConversationId=id/);
});

test('full browser E2E requires local-only endpoints and two synthetic authenticated users', async () => {
  const runner = await read('tests/staging/local-supabase/local-browser-e2e.mjs');
  for (const token of [
    'api.port !== expectedApiPort',
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
    'lastRealtimeConversationId',
    'receivedMessage.count(), 1',
    'reloadedMessage.count(), 1',
    "['direct_a', 'direct_b', 'direct_c']",
    'prove cross-conversation event isolation',
    'Foreign conversation isolation',
    'foreignMessageVisible',
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
  assert.ok(replay.indexOf("local-browser-e2e.mjs") > replay.indexOf("message-auto-cleanup-storage-runtime.mjs"));
  assert.ok(replay.indexOf("local-browser-e2e.mjs") < replay.indexOf("const patchManifest"));
  const workflow = await read('.github/workflows/disposable-local-supabase-runtime.yml');
  assert.match(workflow, /playwright@1\.56\.1/);
  assert.match(workflow, /playwright install --with-deps chromium/);
});
