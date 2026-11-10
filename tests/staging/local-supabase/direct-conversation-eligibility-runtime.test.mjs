import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = path.join(root, 'tests/staging/local-supabase/fixtures');
const read = name => readFile(path.join(fixtureDir, name), 'utf8');

test('synthetic Auth identities are seeded before membership triggers without bypassing them', async () => {
  const [authSeed, membershipBase, dagText] = await Promise.all([
    read('synthetic-direct-chat-auth-before-membership.sql'),
    readFile(path.join(root, 'database/changes/20261107144109_private_membership_system_20261107.sql'), 'utf8'),
    readFile(path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8')
  ]);
  const dag = JSON.parse(dagText);
  assert.match(authSeed, /TEST ONLY/i);
  assert.match(authSeed, /INSERT INTO auth\.users/i);
  assert.doesNotMatch(authSeed, /INSERT INTO public\.profiles/i);
  assert.doesNotMatch(authSeed, /session_replication_role|DISABLE TRIGGER|DROP TRIGGER/i);
  assert.match(authSeed, /direct-unconfirmed@bizmindmakers\.test/);
  assert.match(authSeed, /direct-missing-profile@bizmindmakers\.test/);
  assert.match(authSeed, /971001000002/);
  assert.match(authSeed, /971001000007/);
  assert.match(authSeed, /count\(DISTINCT raw_app_meta_data/);
  assert.match(authSeed, /email_confirmed_at[\s\S]*?NULL/);
  assert.match(membershipBase, /CREATE TRIGGER auth_users_require_membership_invite/i);
  assert.match(membershipBase, /CREATE TRIGGER auth_users_create_member_profile/i);
  const node = dag.nodes.find(item => item.id === 'test-fixture.direct-chat-auth-seed');
  assert.ok(node);
  assert.ok(node.requires.includes('core.base'));
  assert.ok(dag.explicitEdges.some(([from, to]) =>
    from === 'test-fixture.direct-chat-auth-seed' && to === 'membership.base'));
});

test('synthetic profiles are inserted after the profile guard and before official verification rewrite', async () => {
  const [profiles, official, dagText] = await Promise.all([
    read('synthetic-direct-chat-profiles-after-membership.sql'),
    read('20261107152550_official_forever_membership_numbers_manual_verification.sql'),
    readFile(path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8')
  ]);
  const dag = JSON.parse(dagText);
  assert.match(profiles, /INSERT INTO public\.profiles/i);
  assert.match(profiles, /direct_a/);
  assert.match(profiles, /direct_b/);
  assert.match(profiles, /direct_unverified/);
  assert.match(profiles, /direct_unconfirmed/);
  assert.match(profiles, /deliberately omitted/i);
  assert.match(profiles, /membership_number IS DISTINCT FROM u\.raw_app_meta_data/);
  assert.match(official, /membership_number_verified boolean not null default false/i);
  assert.match(official, /membership_number_verified = \(membership_number = '971001000001'\)/);
  const node = dag.nodes.find(item => item.id === 'test-fixture.direct-chat-profiles');
  assert.ok(node);
  assert.ok(node.requires.includes('membership.base'));
  assert.ok(dag.explicitEdges.some(([from, to]) =>
    from === 'membership.base' && to === 'test-fixture.direct-chat-profiles'));
  assert.ok(dag.explicitEdges.some(([from, to]) =>
    from === 'test-fixture.direct-chat-profiles' && to === 'membership.official'));
});

test('PostgreSQL runtime assertions cover success, rejection, reuse, and RPC ACL inside rollback', async () => {
  const sql = await read('direct-conversation-eligibility-runtime.test.sql');
  assert.equal(sql.includes('\nBEGIN;'), true);
  assert.match(sql.trimEnd(), /ROLLBACK;$/);
  assert.match(sql, /public\.admin_set_member_official_number/);
  assert.match(sql, /public\.admin_update_membership_status/);
  assert.match(sql, /DO \$membership_format\$/);
  assert.match(sql, /profiles_membership_number_official_format/);
  assert.match(sql, /member_invitation_number_format/);
  for (const signature of [
    'admin_create_official_member_invites_impl',
    'admin_set_member_official_number_impl',
    'create_profile_for_invited_user',
    'enforce_invited_auth_signup',
    'guard_profile_membership_fields',
    'is_active_member'
  ]) assert.ok(sql.includes(signature), 'missing membership format assertion for ' + signature);
  assert.match(sql, /Invalid official membership number was accepted/);
  assert.match(sql, /public\.get_or_create_direct_conversation/);
  assert.match(sql, /SET LOCAL statement_timeout = '30s'/);
  assert.match(sql, /SET LOCAL lock_timeout = '10s'/);
  assert.match(sql, /app_private\.get_or_create_direct_conversation_impl/);
  for (const label of [
    'suspended target', 'suspended caller', 'unverified target', 'unverified caller',
    'unconfirmed target', 'unconfirmed caller', 'missing profile target', 'missing auth user target',
    'missing profile caller', 'missing auth user caller'
  ]) assert.ok(sql.includes(label), 'missing runtime denial case: ' + label);
  assert.match(sql, /Unauthenticated caller was accepted/);
  assert.match(sql, /Self-target was accepted/);
  assert.match(sql, /Null target was accepted/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /aclexplode/);
  assert.match(sql, /SET LOCAL ROLE service_role/);
  assert.match(sql, /service_role invocation without an authenticated user was accepted/);
  assert.match(sql, /two-session reversed-pair concurrency is a separate required test/i);
  assert.doesNotMatch(sql, /auth_users_placeholder|session_replication_role|DISABLE TRIGGER/i);
});

test('runtime fixture remains design-only and cannot authorize local/cloud execution', async () => {
  const dag = JSON.parse(await readFile(
    path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(
    path.join(root, 'tests/staging/local-supabase/replay-manifest.json'), 'utf8'));
  const node = dag.nodes.find(item => item.id === 'test-fixture.direct-chat-runtime');
  assert.ok(node);
  assert.equal(node.status, 'TEST_ONLY_POSTGRESQL_RUNTIME_ASSERTIONS_NOT_EXECUTED');
  assert.ok(node.blockedBy.includes('DAG-014'));
  assert.ok(node.blockedBy.includes('DAG-015'));
  assert.ok(node.requires.includes('membership.final-format'));
  assert.ok(node.requires.includes('chat.direct-conversation-rpc-eligibility-guard'));
  assert.equal(dag.status, 'BLOCKED');
  assert.equal(dag.executionAuthorized, false);
  assert.equal(dag.safety.sqlExecutionEnabled, false);
  assert.equal(dag.safety.supabaseStartupAuthorized, false);
  assert.equal(dag.safety.cloudConnectionsAllowed, false);
  assert.equal(dag.safety.productionDataAllowed, false);
  assert.equal(manifest.mode, 'DESIGN_ONLY');
  assert.equal(manifest.status, 'BLOCKED');
  assert.equal(manifest.execution.enabled, false);
  assert.deepEqual(manifest.execution.files, []);
  assert.equal(manifest.execution.sqlExecuted, false);
  assert.equal(manifest.execution.localStackStarted, false);
  assert.equal(manifest.execution.cloudAllowed, false);
  assert.equal(manifest.execution.productionAllowed, false);
});

test('two-session concurrency runner is restricted to disposable loopback PostgreSQL', async () => {
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/direct-conversation-concurrency.mjs'), 'utf8');
  assert.match(runner, /LOCAL_SUPABASE_DB_URL/);
  assert.match(runner, /const eligibleSql/);
  assert.match(runner, /statement_timeout = '20s'/);
  assert.match(runner, /lock_timeout = '10s'/);
  assert.match(runner, /PGCONNECT_TIMEOUT: '5'/);
  assert.match(runner, /PATH: process\.env\.PATH/);
  assert.doesNotMatch(runner, /\.\.\.process\.env/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /url\.port !== '54322'/);
  assert.match(runner, /url\.username !== 'postgres'/);
  assert.match(runner, /Promise\.allSettled/);
  assert.match(runner, /pg_sleep\(1\.5\)/);
  assert.match(runner, /SELECT count\(\*\)::text FROM public\.conversations/);
  assert.match(runner, /callSql\(callerA, callerB\)/);
  assert.match(runner, /callSql\(callerB, callerA\)/);
  assert.match(runner, /Refusing non-local database target/);
  assert.match(runner, /NOT EXISTS \(SELECT 1 FROM public\.chat_messages/);
  assert.match(runner, /conversationIds/);
  assert.doesNotMatch(runner, /supabase\.co|service_role key|SUPABASE_SERVICE_ROLE_KEY/i);
  const dag = JSON.parse(await readFile(path.join(root, 'tests/staging/local-supabase/reviewed-dependency-dag.json'), 'utf8'));
  const node = dag.nodes.find(item => item.id === 'test-fixture.direct-chat-concurrency');
  assert.ok(node);
  assert.equal(node.status, 'TEST_ONLY_LOCAL_TWO_SESSION_CONCURRENCY_HARNESS_NOT_EXECUTED');
  assert.ok(node.blockedBy.includes('DAG-014'));
  assert.ok(node.blockedBy.includes('DAG-015'));
  assert.ok(dag.explicitEdges.some(([from, to]) => from === 'test-fixture.direct-chat-runtime' && to === node.id));
});
