import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(root, 'tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql');
const provenancePath = path.join(root, 'tests/staging/local-supabase/fixtures/direct-conversation-rpc.provenance.json');

test('restored direct-conversation RPC fixture matches its recorded provenance hash', async () => {
  const sql = await readFile(fixturePath, 'utf8');
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  const digest = createHash('sha256').update(sql, 'utf8').digest('hex');
  assert.equal(digest, provenance.fixtureSha256);
  assert.equal(provenance.mode, 'TEST_COPY_ONLY');
  assert.equal(provenance.execution.enabled, false);
  assert.equal(provenance.execution.sqlExecuted, false);
  assert.equal(provenance.execution.productionAllowed, false);
  assert.equal(provenance.execution.cloudAllowed, false);
});

test('internal RPC preserves authorization, target validation, locking, and duplicate reuse', async () => {
  const sql = await readFile(fixturePath, 'utf8');
  const internalStart = sql.indexOf('CREATE OR REPLACE FUNCTION app_private.get_or_create_direct_conversation_impl');
  const publicStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation');
  assert.notEqual(internalStart, -1);
  assert.ok(publicStart > internalStart);
  const internal = sql.slice(internalStart, publicStart);
  for (const fragment of [
    'SECURITY DEFINER',
    "SET search_path TO ''",
    'v_user_id := auth.uid()',
    "raise exception 'Authentication required'",
    'p_other_user_id is null or p_other_user_id = v_user_id',
    'public.profiles p where p.id = p_other_user_id',
    'pg_advisory_xact_lock(hashtextextended(v_pair_key, 0))',
    "where c.type = 'direct'",
    ') = 2',
    "values ('direct', null, v_user_id)",
    "(v_conversation_id, p_other_user_id, 'member')"
  ]) assert.ok(internal.includes(fragment), 'missing authoritative behavior: ' + fragment);
  assert.ok(!/active[_ ]membership/i.test(internal), 'do not imply an active-membership predicate exists in the recovered function');
});

test('public RPC is invoker-rights and function ACL excludes PUBLIC and anon', async () => {
  const sql = await readFile(fixturePath, 'utf8');
  const publicStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation');
  const aclStart = sql.indexOf('REVOKE ALL ON FUNCTION app_private.get_or_create_direct_conversation_impl', publicStart);
  const wrapper = sql.slice(publicStart, aclStart);
  assert.ok(wrapper.includes("SET search_path TO 'pg_catalog', 'public', 'app_private'"));
  assert.ok(!wrapper.includes('SECURITY DEFINER'));
  assert.ok(sql.includes('FROM PUBLIC, anon, authenticated, service_role'));
  assert.ok(sql.includes('TO authenticated, service_role'));
});

test('source review keeps the missing caller and target active-membership guards visible', async () => {
  const sql = await readFile(fixturePath, 'utf8');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION app_private.get_or_create_direct_conversation_impl');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation');
  const internal = sql.slice(start, end);
  assert.ok(!internal.includes('app_private.is_active_member()'), 'caller active-membership guard is absent');
  assert.ok(!internal.includes('p.membership_status'));
  assert.ok(!internal.includes('p.membership_number_verified'));
  assert.ok(!internal.includes('auth.users'));
});
