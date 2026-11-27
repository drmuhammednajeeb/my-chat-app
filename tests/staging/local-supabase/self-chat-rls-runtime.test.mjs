import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('self-chat RPC uses a narrow authenticated SECURITY DEFINER boundary', async () => {
  const migration = await readFile(path.join(root,
    'supabase/migrations/20261126150000_harden_self_chat_creation_under_membership_rls.sql'), 'utf8');
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /membership_status = 'active'/);
  assert.match(migration, /membership_number_verified IS TRUE/);
  assert.ok(migration.includes("membership_number ~ '^971[0-9]{9}$'"));
  assert.match(migration, /email_confirmed_at IS NOT NULL/);
  assert.match(migration, /FOR SHARE OF p, u/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ensure_self_chat\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ensure_self_chat\(\) TO authenticated/);
});

test('self-chat SQL fixture proves idempotency, ownership, denials and ACL in rollback', async () => {
  const sql = await readFile(path.join(root,
    'tests/staging/local-supabase/fixtures/self-chat-membership-rls.runtime.test.sql'), 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql.trimEnd(), /ROLLBACK;$/);
  assert.match(sql, /public\.ensure_self_chat\(\)/);
  assert.match(sql, /Self-chat creation must be idempotent/);
  assert.match(sql, /Self-chat row must belong only to the authenticated caller/);
  assert.match(sql, /suspended member/);
  assert.match(sql, /unverified membership/);
  assert.match(sql, /unconfirmed email/);
  assert.match(sql, /Self-chat accepted an unauthenticated caller/);
  assert.match(sql, /aclexplode/);
  assert.match(sql, /prosecdef/);
  assert.doesNotMatch(sql, /supabase\.co|service_role|DROP TRIGGER|DISABLE TRIGGER/i);
});

test('self-chat runtime fixture is explicitly restricted to disposable local replay', async () => {
  const runner = await readFile(path.join(root,
    'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  const workflow = await readFile(path.join(root,
    '.github/workflows/disposable-local-supabase-runtime.yml'), 'utf8');
  assert.match(runner, /LOCAL_SUPABASE_DB_URL/);
  assert.match(runner, /Refusing non-local database target/);
  assert.match(workflow, /Disposable local Supabase runtime verification/);
  const dag = JSON.parse(await readFile(path.join(root,
    'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8'));
  const repair = dag.nodes.find(node => node.id === 'security.self-chat-rls-repair');
  const runtime = dag.nodes.find(node => node.id === 'test-fixture.self-chat-runtime');
  assert.ok(repair && runtime);
  assert.ok(repair.requires.includes('security.active-membership-rls-forward'));
  assert.ok(repair.requires.includes('chat.latest-visible-conversation-previews'));
  assert.ok(repair.requires.includes('test-fixture.direct-chat-runtime'));
  assert.ok(runtime.requires.includes('security.self-chat-rls-repair'));
  assert.equal(repair.status, 'FORWARD_RECONCILIATION_LOCAL_RUNTIME_PASSED_NOT_APPLIED_TO_PRODUCTION');
  assert.equal(runtime.status, 'TEST_ONLY_SELF_CHAT_MEMBERSHIP_RLS_RUNTIME_PASSED');
  assert.equal(runtime.runtimeEvidence.workflowRunId, 45842223208);
  assert.equal(runtime.runtimeEvidence.commit, '01a1d1d3e55b114ec36bdef094e66500cd8e2852');
  const manifest = JSON.parse(await readFile(path.join(root,
    'tests/staging/local-supabase/replay-manifest.json'), 'utf8'));
  const order = manifest.candidateNodeOrder.map(node => node.nodeId);
  assert.ok(order.indexOf('security.self-chat-rls-repair') > order.indexOf('security.active-membership-rls-forward'));
  assert.ok(order.indexOf('test-fixture.self-chat-runtime') > order.indexOf('security.self-chat-rls-repair'));
});
