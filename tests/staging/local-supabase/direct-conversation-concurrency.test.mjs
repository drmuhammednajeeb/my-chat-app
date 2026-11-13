import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('concurrency probe establishes its synthetic pair after rollback-only eligibility tests', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs'), 'utf8');
  assert.match(source, /localDatabaseUrl\(\)/);
  assert.match(source, /LOCAL_SYNTHETIC_AUTH_USERS_JSON/);
  assert.match(source, /syntheticIds\?\.direct_a/);
  assert.match(source, /syntheticIds\?\.direct_b/);
  assert.match(source, /admin_set_member_official_number/);
  assert.match(source, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(source, /22222222-2222-4222-8222-22222222220[12]/);
  assert.match(source, /971001000002/);
  assert.match(source, /971001000003/);
  assert.ok(source.indexOf('admin_set_member_official_number') < source.indexOf('const eligibleSql'));
  assert.match(source, /Synthetic participant pair is not fully eligible/);
  assert.match(source, /Array\.from\(\{ length: 24 \}/);
  assert.match(source, /Array\.from\(\{ length: 40 \}/);
  assert.match(source, /public\.chat_messages\(conversation_id, sender_id, content\)/);
  assert.match(source, /40 concurrent authenticated message writes persisted uniquely/);
});

test('concurrency probe remains loopback-only and cleans only its generated conversation', async () => {
  const [source, rpc] = await Promise.all([
    readFile(path.join(root, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs'), 'utf8'),
    readFile(path.join(root, 'tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql'), 'utf8')
  ]);
  for (const token of ["'127.0.0.1'", "'localhost'", "'::1'", 'url.port !== expectedDatabasePort', 'LOCAL_SUPABASE_EXPECTED_DB_PORT', "url.username !== 'postgres'", "url.pathname !== '/postgres'", 'Promise.allSettled', 'pg_sleep(0.25)', 'DELETE FROM public.conversations']) {
    assert.ok(source.includes(token), 'missing concurrency safety/behavior check: ' + token);
  }
  assert.match(rpc, /pg_advisory_xact_lock/i);
});
