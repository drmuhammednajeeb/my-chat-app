import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('concurrency probe establishes its synthetic pair after rollback-only eligibility tests', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs'), 'utf8');
  assert.match(source, /localDatabaseUrl\(\)/);
  assert.match(source, /admin_set_member_official_number/);
  assert.match(source, /11111111-1111-4111-8111-111111111111/);
  assert.match(source, /22222222-2222-4222-8222-222222222201/);
  assert.match(source, /22222222-2222-4222-8222-222222222202/);
  assert.match(source, /971001000002/);
  assert.match(source, /971001000003/);
  assert.ok(source.indexOf('admin_set_member_official_number') < source.indexOf('const eligibleSql'));
  assert.match(source, /Synthetic participant pair is not fully eligible/);
});

test('concurrency probe remains loopback-only and cleans only its generated conversation', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs'), 'utf8');
  for (const token of ["'127.0.0.1'", "'localhost'", "'::1'", "url.port !== '54322'", "url.username !== 'postgres'", "url.pathname !== '/postgres'", 'Promise.allSettled', 'pg_sleep(1.5)', 'pg_advisory_xact_lock', 'DELETE FROM public.conversations']) {
    assert.ok(source.includes(token), 'missing concurrency safety/behavior check: ' + token);
  }
});
