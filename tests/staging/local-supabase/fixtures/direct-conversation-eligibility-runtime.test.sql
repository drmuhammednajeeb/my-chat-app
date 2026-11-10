-- TEST ONLY: PostgreSQL runtime assertions for the direct-conversation eligibility overlay.
-- Run only in the approved disposable local Supabase database after the full dependency replay.
-- All data mutations and the test conversation are rolled back at the end.
-- Two-session reversed-pair concurrency is a separate required test and remains a release blocker.

BEGIN;

-- Establish the test admin context and promote only synthetic accounts through the real admin RPCs.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT public.admin_set_member_official_number(
  '22222222-2222-4222-8222-222222222201', '971001000002');
SELECT public.admin_set_member_official_number(
  '22222222-2222-4222-8222-222222222202', '971001000003');
SELECT public.admin_set_member_official_number(
  '22222222-2222-4222-8222-222222222203', '971001000004');
SELECT public.admin_set_member_official_number(
  '22222222-2222-4222-8222-222222222205', '971001000006');
SELECT public.admin_update_membership_status(
  '22222222-2222-4222-8222-222222222203', 'suspended');

-- Confirm that the fixtures represent the intended authoritative DB states.
DO $fixtures$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.id = '22222222-2222-4222-8222-222222222201'
      AND p.membership_status = 'active'
      AND p.membership_number_verified IS TRUE
      AND u.email_confirmed_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.id = '22222222-2222-4222-8222-222222222202'
      AND p.membership_status = 'active'
      AND p.membership_number_verified IS TRUE
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Eligible synthetic pair was not established';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '22222222-2222-4222-8222-222222222203'
      AND membership_status = 'suspended'
      AND membership_number_verified IS TRUE
  ) THEN
    RAISE EXCEPTION 'Suspended fixture state was not established';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '22222222-2222-4222-8222-222222222204'
      AND membership_number_verified IS FALSE
  ) THEN
    RAISE EXCEPTION 'Unverified-membership fixture state was not established';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auth_users_placeholder
  ) THEN
    NULL;
  END IF;
END
$fixtures$;

-- Successful creation, idempotent reuse, and direct internal invocation under authenticated.
DO $success$
DECLARE
  v_first uuid;
  v_second uuid;
  v_internal uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    '22222222-2222-4222-8222-222222222201', true);

  v_first := public.get_or_create_direct_conversation(
    '22222222-2222-4222-8222-222222222202');
  v_second := public.get_or_create_direct_conversation(
    '22222222-2222-4222-8222-222222222202');
  v_internal := app_private.get_or_create_direct_conversation_impl(
    '22222222-2222-4222-8222-222222222202');

  IF v_first IS NULL OR v_first <> v_second OR v_first <> v_internal THEN
    RAISE EXCEPTION 'Direct conversation creation/reuse mismatch';
  END IF;

  IF (SELECT count(*) FROM public.conversation_members
      WHERE conversation_id = v_first) <> 2 THEN
    RAISE EXCEPTION 'Direct conversation must contain exactly two members';
  END IF;
END
$success$;

-- Both caller-side and target-side eligibility must fail closed.
DO $denials$
DECLARE
  v_case record;
  v_rejected boolean;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222203'::uuid, 'suspended target'),
      ('22222222-2222-4222-8222-222222222203'::uuid, '22222222-2222-4222-8222-222222222201'::uuid, 'suspended caller'),
      ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222204'::uuid, 'unverified target'),
      ('22222222-2222-4222-8222-222222222204'::uuid, '22222222-2222-4222-8222-222222222201'::uuid, 'unverified caller'),
      ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222205'::uuid, 'unconfirmed target'),
      ('22222222-2222-4222-8222-222222222205'::uuid, '22222222-2222-4222-8222-222222222201'::uuid, 'unconfirmed caller'),
      ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222206'::uuid, 'missing profile'),
      ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222299'::uuid, 'missing auth user')
    ) AS cases(caller_id, target_id, label)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_case.caller_id::text, true);
    v_rejected := false;
    BEGIN
      PERFORM public.get_or_create_direct_conversation(v_case.target_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Expected eligibility denial was not raised: %', v_case.label;
    END IF;
  END LOOP;
END
$denials$;

-- Authentication, self-target, and null-target boundary checks.
DO $boundaries$
DECLARE
  v_rejected boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_rejected := false;
  BEGIN
    PERFORM public.get_or_create_direct_conversation(
      '22222222-2222-4222-8222-222222222202');
  EXCEPTION WHEN SQLSTATE '28000' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Unauthenticated caller was accepted'; END IF;

  PERFORM set_config('request.jwt.claim.sub',
    '22222222-2222-4222-8222-222222222201', true);

  v_rejected := false;
  BEGIN
    PERFORM public.get_or_create_direct_conversation(
      '22222222-2222-4222-8222-222222222201');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Self-target was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.get_or_create_direct_conversation(NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Null target was accepted'; END IF;
END
$boundaries$;

-- Verify least-privilege EXECUTE grants and absence of PUBLIC/anon access.
DO $acl$
DECLARE
  v_internal_oid oid := 'app_private.get_or_create_direct_conversation_impl(uuid)'::regprocedure;
  v_public_oid oid := 'public.get_or_create_direct_conversation(uuid)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', v_internal_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_internal_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_internal_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_public_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_public_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_public_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Direct-conversation RPC ACL does not match the reviewed allowlist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN (v_internal_oid, v_public_oid)
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC has EXECUTE on a direct-conversation RPC';
  END IF;
END
$acl$;

RESET ROLE;
ROLLBACK;
