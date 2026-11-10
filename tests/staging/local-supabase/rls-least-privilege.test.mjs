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
  assert.match(sql, /app\.test_only_local_replay/i);
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
    'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, ANON, AUTHENTICATED, SERVICE_ROLE',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public',
    'REVOKE INSERT, UPDATE, DELETE ON public.conversation_member_events',
    'REVOKE UPDATE, DELETE ON public.private_reply_contexts',
    'REVOKE DELETE ON public.user_settings',
    'REVOKE DELETE ON public.conversation_group_settings',
    'as restrictive for all to authenticated',
    'Require active membership for all Storage operations',
    'Do not query storage.buckets from this policy',
    'using ((select app_private.is_active_member()))',
    'with check ((select app_private.is_active_member()))'
  ]) assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'missing hardening clause: ' + token);
  assert.match(sql, /revoke maintain on all tables in schema public from authenticated/i);
});

test('read-only assertions cover RLS, active membership, table, sequence, function, trigger and both migration-owner default ACLs', async () => {
  const sql = await readFile(assertionPath, 'utf8');
  for (const token of [
    'relrowsecurity',
    'pg_policies',
    'is_active_member',
    'has_table_privilege',
    'has_sequence_privilege',
    'has_function_privilege',
    'pg_default_acl',
    "d.defaclrole in ('postgres'::regrole, 'supabase_admin'::regrole)",
    "p.prorettype = 'trigger'::regtype",
    'aclexplode',
    'storage.objects',
    'Users upload own avatar',
    'Users update own avatar',
    'Users delete own avatar',
    'foldername(name)',
    'search_path=""',
    'has_schema_privilege',
    'bucket_id',
    'Every bucket-specific Storage object policy must be scoped to a bucket',
    "p.policyname <> 'Require active membership for all Storage operations'",
    "restrictive Storage guard must not query storage.buckets under bucket RLS",
    'RESTRICTIVE',
    'Require active membership for all API operations',
    "not has_table_privilege('authenticated','public.user_message_stars','UPDATE')",
    "not has_table_privilege('authenticated','public.chat_list_items','UPDATE')",
    "not has_table_privilege('authenticated','public.message_edit_history','INSERT')",
    "has_table_privilege('authenticated','public.user_settings','DELETE')"
  ]) assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'missing assertion: ' + token);
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+\w|delete\s+from|create\s+table|alter\s+table)\b/i);
});

test('assertion file is guarded to a disposable local database', async () => {
  const sql = await readFile(assertionPath, 'utf8');
  assert.match(sql, /current_database\(\)\s*<>\s*'postgres'/i);
  assert.match(sql, /current_user\s*<>\s*'postgres'/i);
  assert.match(sql, /app\.test_only_local_replay/i);
});


test('manual RLS runtime runner refuses cloud targets and runs only loopback PostgreSQL', async () => {
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs'), 'utf8');
  for (const fragment of [
    'LOCAL_SUPABASE_DB_URL',
    "url.port !== '54322'",
    "url.username !== 'postgres'",
    "url.pathname !== '/postgres'",
    "127.0.0.1",
    "'localhost'",
    "'::1'",
    'app.test_only_local_replay=enabled',
    'rls-least-privilege-overlay.test-only.sql',
    'rls-least-privilege.assert.sql',
    'rls-crud-compatibility.runtime.test.sql'
  ]) assert.ok(runner.includes(fragment), 'missing local runner safeguard: ' + fragment);
  assert.match(runner, /refusing non-local database target/i);
  assert.doesNotMatch(runner, /supabase\.co|SUPABASE_SERVICE_ROLE_KEY|service_role key/i);
});


test('CRUD runtime fixture verifies upsert, secure edit, and cross-user isolation', async () => {
  const sql = await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/rls-crud-compatibility.runtime.test.sql'), 'utf8');
  for (const token of [
    'get_or_create_direct_conversation',
    'chat_messages',
    'chat_lists',
    'chat_list_items',
    'ON CONFLICT(user_id,list_id,conversation_id)',
    'user_message_stars',
    'ON CONFLICT(user_id,message_id)',
    'edit_message_secure',
    'message_edit_history',
    'Cross-user chat list read was not isolated',
    'Cross-user chat list INSERT was accepted',
    'ROLLBACK'
  ]) assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'missing CRUD runtime check: ' + token);
  assert.match(sql, /SET LOCAL ROLE authenticated/i);
  assert.match(sql, /request.jwt.claim.sub/i);
});
