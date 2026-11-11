import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/202611110001_enforce_chat_message_48h_retention.sql', import.meta.url),
  'utf8'
);

test('message expiry is enforced for inserts and updates at database level', () => {
  assert.match(migration, /create trigger prepare_group_message_expiry\s+before insert or update on public\.chat_messages/i);
  assert.match(migration, /new\.expires_at := new\.created_at \+ interval '48 hours'/i);
  assert.match(migration, /security invoker/i);
});

test('existing messages are normalized from their original creation timestamp', () => {
  assert.match(migration, /update public\.chat_messages\s+set expires_at = created_at \+ interval '48 hours'/i);
  assert.match(migration, /where expires_at is distinct from \(created_at \+ interval '48 hours'\)/i);
  assert.match(migration, /alter column expires_at set not null/i);
  assert.match(migration, /chat_messages_exact_48h_expiry/i);
});

test('purge worker processes every expired message in bounded batches', () => {
  assert.match(migration, /where m\.expires_at <= pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /limit 5000/i);
  assert.match(migration, /exit when v_batch_deleted = 0/i);
});

test('automatic cleanup runs every minute and replaces the old schedule', () => {
  assert.match(migration, /cron\.unschedule\(v_job\.jobid\)/i);
  assert.match(migration, /'\* \* \* \* \*'/);
  assert.match(migration, /purge-expired-chat-messages-48h/);
});

test('migration does not bypass the Supabase Storage API', () => {
  assert.doesNotMatch(migration, /delete\s+from\s+storage\.objects/i);
});
