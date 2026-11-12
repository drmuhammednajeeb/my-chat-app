import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = path.join(root, 'tests/staging/local-supabase/fixtures');
const guardPath = path.join(fixtureDir, 'direct-conversation-rpc-eligibility-guard.sql');
const originalPath = path.join(fixtureDir, 'direct-conversation-rpc.sql');

test('eligibility guard is a separate test-only overlay and preserves the recovered source fixture', async () => {
  const [guard, original, provenance] = await Promise.all([
    readFile(guardPath, 'utf8'),
    readFile(originalPath, 'utf8'),
    readFile(path.join(fixtureDir, 'direct-conversation-rpc.provenance.json'), 'utf8').then(JSON.parse)
  ]);
  assert.match(guard, /TEST ONLY/i);
  assert.match(guard, /disposable local Supabase replay/i);
  assert.match(guard, /CREATE OR REPLACE FUNCTION app_private\.get_or_create_direct_conversation_impl/);
  assert.doesNotMatch(guard, /CREATE OR REPLACE FUNCTION public\.get_or_create_direct_conversation/);
  assert.match(original, /authoritative direct-conversation RPC source recovered/i);
  assert.equal(provenance.mode, 'TEST_COPY_ONLY');
  assert.equal(provenance.execution.productionAllowed, false);
  assert.equal(provenance.execution.cloudAllowed, false);
});

test('caller and target eligibility are checked against authoritative database rows', async () => {
  const guard = await readFile(guardPath, 'utf8');
  for (const fragment of [
    'if not app_private.is_active_member() then',
    'p.membership_status = \'active\'',
    'p.membership_number_verified IS TRUE',
    "p.membership_number ~ '^971[0-9]{9}$'",
    'u.email_confirmed_at IS NOT NULL',
    'FOR SHARE OF p, u',
    'GET DIAGNOSTICS v_eligible_count = ROW_COUNT',
    'if v_eligible_count <> 2 then',
    "using errcode = '42501'"
  ]) assert.ok(guard.includes(fragment), 'missing eligibility guard: ' + fragment);
  assert.doesNotMatch(guard, /raw_user_meta_data|user_metadata|auth\.jwt\(\)/i);
});

test('original concurrency serialization, duplicate reuse, and internal ACL are retained', async () => {
  const guard = await readFile(guardPath, 'utf8');
  for (const fragment of [
    'pg_advisory_xact_lock(hashtextextended(v_pair_key, 0))',
    "where c.type = 'direct'",
    'select count(*) from public.conversation_members cm',
    "values ('direct', null, v_user_id)",
    "(v_conversation_id, p_other_user_id, 'member')",
    'FROM PUBLIC, anon, authenticated, service_role',
    'TO authenticated, service_role'
  ]) assert.ok(guard.includes(fragment), 'missing preserved RPC behavior: ' + fragment);
  assert.match(guard, /SET search_path TO ''/);
  assert.match(guard, /SECURITY DEFINER/);
});

test('test-only guard does not authorize cloud, production, or SQL execution', async () => {
  const guard = await readFile(guardPath, 'utf8');
  assert.match(guard, /Never execute against a cloud project/i);
  assert.match(guard, /not a production migration/i);
  assert.doesNotMatch(guard, /^\s*(create|alter|drop)\s+(table|schema|extension|policy|trigger)\b/im);
});

test('dependency graph keeps the guard test-only and runtime-gated', async () => {
  const dag = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8'));
  const node = dag.nodes.find(item => item.id === 'chat.direct-conversation-rpc-eligibility-guard');
  assert.ok(node, 'eligibility guard node is missing from the dependency graph');
  assert.equal(node.status, 'TEST_ONLY_GUARD_LOCAL_RUNTIME_PASSED');
  assert.deepEqual(node.blockedBy, []);
  assert.equal(dag.status, 'BLOCKED');
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.safety.sqlExecutionEnabled, false);
  assert.equal(dag.safety.cloudConnectionsAllowed, false);
  assert.equal(dag.safety.productionDataAllowed, false);
});
