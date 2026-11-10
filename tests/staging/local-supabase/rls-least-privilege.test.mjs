import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const overlayPath = path.join(root, 'tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql');
const assertionPath = path.join(root, 'tests/staging/local-supabase/fixtures/rls-least-privilege.assert.sql');

test('least-privilege overlay is explicitly local-only and loopback guarded', async () => {
  const sql = await readFile(overlayPath, 'utf8');
  assert.match(sql, /TEST-ONLY/i);
  assert.match(sql, /current_database\(\)\s*<>\s*'postgres'/i);
  assert.match(sql, /current_user\s*<>\s*'postgres'/i);
  assert.match(sql, /inet_server_addr\(\)/i);
  assert.match(sql, /127\.0\.0\.0\/8/);
  assert.match(sql, /::1/);
  assert.doesNotMatch(sql, /https?:\/\//i);
  assert.doesNotMatch(sql, /service_role\s*=/i);
});

test('least-privilege overlay revokes dangerous and unnecessary API privileges', async () => {
  const sql = await readFile(overlayPath, 'utf8');
  for (const token of [
    'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM public, anon',
    'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated',
    'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM public, anon, authenticated',
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public, anon',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public',
    'REVOKE INSERT, UPDATE, DELETE ON public.conversation_member_events',
    'REVOKE INSERT ON public.message_edit_history',
    'REVOKE UPDATE, DELETE ON public.private_reply_contexts',
    'REVOKE UPDATE ON public.user_message_stars',
    'REVOKE DELETE ON public.user_settings',
    'REVOKE UPDATE ON public.chat_list_items',
    'REVOKE DELETE ON public.conversation_group_settings'
  ]) assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'missing hardening clause: ' + token);
  assert.match(sql, /REVOKEs+MAINTAIN[sS]*?authenticated/i);
});

test('read-only assertions cover RLS, active membership, table, sequence, function and default ACLs', async () => {
  const sql = await readFile(assertionPath, 'utf8');
  for (const token of [
    'relrowsecurity',
    'pg_policies',
    'is_active_member',
    'has_table_privilege',
    'has_sequence_privilege',
    'has_function_privilege',
    'pg_default_acl',
    'aclexplode'
  ]) assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'missing assertion: ' + token);
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+\w|delete\s+from|create\s+table|alter\s+table)\b/i);
});

test('assertion file is guarded to a disposable local database', async () => {
  const sql = await readFile(assertionPath, 'utf8');
  assert.match(sql, /current_database\(\)\s*<>\s*'postgres'/i);
  assert.match(sql, /current_user\s*<>\s*'postgres'/i);
  assert.match(sql, /inet_server_addr\(\)/i);
});
