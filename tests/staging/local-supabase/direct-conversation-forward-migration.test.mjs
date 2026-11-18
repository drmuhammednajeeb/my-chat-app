import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = relative => readFile(path.join(root, relative), 'utf8');

const migrationPath = 'supabase/migrations/20261112160000_harden_direct_conversation_eligibility.sql';

test('forward migration requires an authenticated, eligible caller and eligible target before writes', async () => {
  const sql = await read(migrationPath);
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION app_private.get_or_create_direct_conversation_impl');
  assert.notEqual(start, -1);
  const end = sql.indexOf('$function$;', start);
  assert.ok(end > start);
  const body = sql.slice(start, end);

  for (const fragment of [
    'SECURITY DEFINER',
    "SET search_path TO ''",
    'v_user_id := auth.uid()',
    "using errcode = '28000'",
    'p_other_user_id is null or p_other_user_id = v_user_id',
    'if not app_private.is_active_member() then',
    'FROM public.profiles p',
    'JOIN auth.users u ON u.id = p.id',
    'p.id IN (v_user_id, p_other_user_id)',
    "p.membership_status = 'active'",
    'p.membership_number_verified IS TRUE',
    "p.membership_number ~ '^971[0-9]{9}$'",
    'u.email_confirmed_at IS NOT NULL',
    'ORDER BY p.id',
    'FOR SHARE OF p, u',
    'GET DIAGNOSTICS v_eligible_count = ROW_COUNT',
    'v_eligible_count <> 2',
    "using errcode = '42501'"
  ]) assert.ok(body.includes(fragment), 'missing forward-migration guard: ' + fragment);

  const eligibilityEnd = body.indexOf('v_pair_key :=');
  const lockStart = body.indexOf('pg_advisory_xact_lock');
  const firstWrite = body.indexOf('insert into public.conversations');
  assert.ok(eligibilityEnd > 0 && lockStart > eligibilityEnd);
  assert.ok(firstWrite > lockStart);
});

test('membership helper is not mistaken for the full eligibility rule', async () => {
  const [membershipSql, migration] = await Promise.all([
    read('supabase/migrations/20261107144109_private_membership_system_20261107.sql'),
    read(migrationPath)
  ]);
  const start = membershipSql.indexOf('create or replace function app_private.is_active_member()');
  const end = membershipSql.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start);
  const helper = membershipSql.slice(start, end);
  assert.match(helper, /p\.membership_status='active'/);
  assert.match(helper, /u\.email_confirmed_at is not null/);
  assert.doesNotMatch(helper, /membership_number_verified|membership_number\s*~/i);

  // Verified membership and the official number format are enforced by the
  // authoritative, locked two-participant query in the forward migration.
  assert.match(migration, /p\.membership_number_verified IS TRUE/);
  assert.match(migration, /p\.membership_number ~ '\^971\[0-9\]\{9\}\$'/);
});

test('forward migration preserves pair serialization, exact-pair reuse, and two-member creation', async () => {
  const sql = await read(migrationPath);
  for (const fragment of [
    'pg_advisory_xact_lock(hashtextextended(v_pair_key, 0))',
    "where c.type = 'direct'",
    'cm.user_id = v_user_id',
    'cm.user_id = p_other_user_id',
    'select count(*) from public.conversation_members cm',
    ') = 2',
    "values ('direct', null, v_user_id)",
    "(v_conversation_id, v_user_id, 'owner')",
    "(v_conversation_id, p_other_user_id, 'member')"
  ]) assert.ok(sql.includes(fragment), 'missing preserved behavior: ' + fragment);
});

test('internal SECURITY DEFINER ACL is least-privilege and schema path remains pinned', async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /REVOKE ALL ON FUNCTION app_private\.get_or_create_direct_conversation_impl\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION app_private\.get_or_create_direct_conversation_impl\(uuid\)[\s\S]*?TO authenticated, service_role/i);
  assert.match(sql, /SECURITY DEFINER[\s\S]*?SET search_path TO ''/i);
});

test('post-migration SQL assertions cover eligibility denials and the test runner remains loopback-only', async () => {
  const [assertions, concurrency] = await Promise.all([
    read('tests/staging/local-supabase/fixtures/forward-direct-conversation-eligibility.assert.sql'),
    read('tests/staging/local-supabase/direct-conversation-concurrency.mjs')
  ]);
  for (const label of [
    'suspended target', 'suspended caller',
    'unverified target', 'unverified caller',
    'unconfirmed target', 'unconfirmed caller',
    'missing profile target', 'missing auth user target',
    'Unauthenticated caller was accepted', 'Self-target was accepted', 'Null target was accepted'
  ]) assert.ok(assertions.includes(label), 'missing SQL runtime assertion: ' + label);
  assert.match(assertions.trimEnd(), /ROLLBACK;$/);
  assert.match(concurrency, /LOCAL_SUPABASE_DB_URL/);
  assert.match(concurrency, /url\.port !== '54322'/);
  assert.match(concurrency, /Refusing non-local database target/);
  assert.match(concurrency, /24 concurrent reversed requests|24 real PostgreSQL sessions/);
  assert.match(concurrency, /40 authenticated transactions concurrently insert distinct messages/);
  assert.doesNotMatch(concurrency, /supabase\.co|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('forward migration remains unapplied and execution remains unauthorized in source governance', async () => {
  const [registryText, dagText, manifestText] = await Promise.all([
    read('supabase/migrations/source-registry.json'),
    read('tests/staging/local-supabase/reviewed-dependency-dag.json'),
    read('tests/staging/local-supabase/replay-manifest.json')
  ]);
  const registry = JSON.parse(registryText);
  const dag = JSON.parse(dagText);
  const manifest = JSON.parse(manifestText);
  const entry = registry.forwardMigrations.find(item => item.path === migrationPath);
  assert.ok(entry);
  assert.equal(entry.status, 'FORWARD_RECONCILIATION_NOT_APPLIED');
  assert.equal(entry.productionApplied, false);
  assert.equal(dag.safety.forwardMigrationExecutionAuthorized, false);
  assert.equal(dag.safety.productionDataAllowed, false);
  assert.equal(manifest.execution.enabled, false);
  assert.equal(manifest.execution.productionAllowed, false);
});
