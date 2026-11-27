-- Repair self-chat creation under the active-membership restrictive RLS boundary.
-- SECURITY DEFINER is narrowly scoped: caller identity and current membership are
-- revalidated against authoritative rows and locked before either write.
-- The function can create only the caller's own single personal conversation.

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_self_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_conversation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- SECURITY DEFINER bypasses table RLS; preserve the non-bypassable membership
  -- contract explicitly and serialize this write against suspension/revocation.
  PERFORM 1
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_user_id
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  FOR SHARE OF p, u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active verified membership is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversations (type, title, description, created_by)
  VALUES ('group', 'ملاحظاتي', 'bizmindmakers:self-chat:v1', v_user_id)
  ON CONFLICT (created_by)
    WHERE type = 'group' AND description = 'bizmindmakers:self-chat:v1'
  DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT c.id INTO v_conversation_id
    FROM public.conversations c
    WHERE c.created_by = v_user_id
      AND c.type = 'group'
      AND c.description = 'bizmindmakers:self-chat:v1'
    LIMIT 1;
  END IF;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Could not initialize personal chat' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conversation_id, v_user_id, 'owner')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_self_chat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_self_chat() TO authenticated;

COMMIT;
