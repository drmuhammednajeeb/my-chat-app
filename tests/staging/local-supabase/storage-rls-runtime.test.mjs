import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('Storage RLS runtime probe is restricted to the disposable local API', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/local-storage-rls-runtime.mjs'), 'utf8');
  for (const token of [
    'LOCAL_SUPABASE_URL',
    'LOCAL_SUPABASE_ANON_KEY',
    'LOCAL_SUPABASE_DB_URL',
    'localDatabaseProbe',
    'STORAGE_POLICY_PROBE',
    'STORAGE_POLICY_SET',
    'verify direct conversation membership',
    'app_private.is_conversation_member',
    'LOCAL_SYNTHETIC_AUTH_USERS_JSON',
    "endpoint.protocol !== 'http:'",
    "endpoint.port !== '54321'",
    "'127.0.0.1'",
    "'localhost'",
    "'::1'",
    'direct-a@bizmindmakers.test',
    'direct-b@bizmindmakers.test',
    '/auth/v1/token?grant_type=password',
    '/storage/v1/object/sign/',
    'conversation-documents',
    'chat-media',
    'avatars',
    'STORAGE_RLS_RUNTIME=PASSED'
  ]) assert.ok(source.includes(token), 'missing Storage runtime safeguard/check: ' + token);
  assert.match(source, /refusing non-local API target/i);
  assert.doesNotMatch(source, /LOCAL_SUPABASE_SERVICE_ROLE_KEY|supabase\.co|SUPABASE_URL\s*=/i);

  const replay = await readFile(path.join(root, 'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  for (const token of [
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    '/auth/v1/admin/users',
    "method: 'POST'",
    'test-fixture.direct-chat-auth-seed',
    'LOCAL_SYNTHETIC_AUTH_PASSWORD'
  ]) assert.ok(replay.includes(token), 'missing GoTrue fixture provisioning safeguard: ' + token);
  assert.doesNotMatch(replay, /method: 'PUT'/);
});

test('Storage runtime probe checks uploader ownership, private/shared reads, upsert, and cleanup', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/local-storage-rls-runtime.mjs'), 'utf8');
  for (const token of [
    'cross-user chat-media uploader-folder spoof',
    'other member signed read of private document',
    'shared conversation member signed read',
    'document remains after non-owner delete attempt',
    'cross-user avatar overwrite',
    'public avatar delivery',
    'owner delete ',
    'finally',
    'cleanup()'
  ]) assert.ok(source.toLowerCase().includes(token.toLowerCase()), 'missing Storage behavior check: ' + token);
});
