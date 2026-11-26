-- TEST ONLY: exercise ensure_self_chat under the real authenticated role and restrictive RLS.
-- Executed only by the disposable local Supabase replay; all changes are rolled back.

BEGIN;
SELECT set_config('app.test.self_chat_a_id', :'direct_a_id', true);
SELECT set_config('app.test.self_chat_suspended_id', :'direct_suspended_id', true);
SELECT set_config('app.test.self_chat_unverified_id', :'direct_unverified_id', true);
SELECT set_config('app.test.self_chat_unconfirmed_id', :'direct_unconfirmed_id', true);
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '10s';

SET LOCAL ROLE authenticated;
-- Mark the synthetic suspended identity through the real administrative RPC.
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT public.admin_update_membership_status(
  current_setting('app.test.self_chat_suspended_id')::uuid, 'suspended');

DO $self_chat_success$
DECLARE
  v_first uuid;
  v_second uuid;
  v_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    current_setting('app.test.self_chat_a_id'), true);
  v_first := public.ensure_self_chat();
  v_second := public.ensure_self_chat();

  IF v_first IS NULL OR v_first <> v_second THEN
    RAISE EXCEPTION 'Self-chat creation must be idempotent';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.conversations c
  WHERE c.id = v_first
    AND c.created_by = current_setting('app.test.self_chat_a_id')::uuid
    AND c.type = 'group'
    AND c.description = 'bizmindmakers:self-chat:v1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Self-chat row must belong only to the authenticated caller';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.conversation_members cm
  WHERE cm.conversation_id = v_first
    AND cm.user_id = current_setting('app.test.self_chat_a_id')::uuid
    AND cm.role = 'owner';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Self-chat owner membership must be created exactly once';
  END IF;
END
$self_chat_success$;

DO $self_chat_denials$
DECLARE
  v_case record;
  v_rejected boolean;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      (current_setting('app.test.self_chat_suspended_id')::uuid, 'suspended member'),
      (current_setting('app.test.self_chat_unverified_id')::uuid, 'unverified membership'),
      (current_setting('app.test.self_chat_unconfirmed_id')::uuid, 'unconfirmed email')
    ) AS cases(user_id, label)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_case.user_id::text, true);
    v_rejected := false;
    BEGIN
      PERFORM public.ensure_self_chat();
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Self-chat accepted an ineligible caller: %', v_case.label;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_rejected := false;
  BEGIN
    PERFORM public.ensure_self_chat();
  EXCEPTION WHEN SQLSTATE '28000' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Self-chat accepted an unauthenticated caller';
  END IF;
END
$self_chat_denials$;

DO $self_chat_acl$
DECLARE
  v_oid oid := 'public.ensure_self_chat()'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Self-chat RPC EXECUTE ACL is not restricted to authenticated';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'Self-chat RPC must use its reviewed SECURITY DEFINER boundary';
  END IF;
END
$self_chat_acl$;

RESET ROLE;
ROLLBACK;
