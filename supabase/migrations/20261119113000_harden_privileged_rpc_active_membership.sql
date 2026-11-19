-- Forward reconciliation: enforce active membership inside privileged RPC implementations.
-- RLS restrictive policies do not protect writes performed by SECURITY DEFINER functions.
-- This migration preserves the existing public invoker wrappers and function signatures.

BEGIN;

-- A management helper must not authorize suspended/ineligible members.
CREATE OR REPLACE FUNCTION app_private.can_manage_conversation(target_conversation uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.is_active_member()
     AND EXISTS (
       SELECT 1
       FROM public.conversation_members cm
       WHERE cm.conversation_id = target_conversation
         AND cm.user_id = (SELECT auth.uid())
         AND cm.role IN ('owner', 'admin')
     );
$function$;

-- Private channel creation bypasses table RLS, so lock and validate the caller's
-- authoritative profile/Auth rows before performing privileged writes.
CREATE OR REPLACE FUNCTION app_private.create_private_channel(
  p_title text,
  p_description text DEFAULT ''::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  new_id uuid;
  actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإنشاء قناة' USING ERRCODE = '28000';
  END IF;

  PERFORM 1
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = actor
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  FOR SHARE OF p, u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'إنشاء القنوات متاح للأعضاء النشطين الموثقين فقط'
      USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'اسم القناة يجب أن يكون بين 1 و80 حرفاً';
  END IF;
  IF coalesce(char_length(p_description), 0) > 500 THEN
    RAISE EXCEPTION 'وصف القناة يتجاوز 500 حرف';
  END IF;

  INSERT INTO public.conversations(type,title,description,is_public,created_by)
  VALUES ('channel',btrim(p_title),coalesce(btrim(p_description),''),false,actor)
  RETURNING id INTO new_id;

  INSERT INTO public.conversation_members(conversation_id,user_id,role)
  VALUES (new_id,actor,'owner');

  RETURN new_id;
END;
$function$;

-- Invite creation also requires an active caller. can_manage_conversation now
-- independently enforces active membership as defense in depth.
CREATE OR REPLACE FUNCTION app_private.create_channel_invite(p_conversation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := (SELECT auth.uid());
  token text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  PERFORM 1
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = actor
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  FOR SHARE OF p, u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'مشاركة القنوات متاحة للأعضاء النشطين الموثقين فقط'
      USING ERRCODE = '42501';
  END IF;

  IF NOT app_private.can_manage_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية مشاركة هذه القناة' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.type = 'channel'
  ) THEN
    RAISE EXCEPTION 'القناة غير موجودة';
  END IF;

  UPDATE app_private.channel_invites
  SET revoked_at = now()
  WHERE conversation_id = p_conversation_id AND revoked_at IS NULL;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO app_private.channel_invites(conversation_id, token_hash, created_by, expires_at)
  VALUES (
    p_conversation_id,
    encode(extensions.digest(token, 'sha256'), 'hex'),
    actor,
    now() + interval '7 days'
  );
  RETURN token;
END;
$function$;

-- Joining by bearer invite is a privileged membership write and must not allow
-- suspended or unverified accounts to enter a channel.
CREATE OR REPLACE FUNCTION app_private.join_channel_by_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := (SELECT auth.uid());
  invite_row record;
  inserted_count integer;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً' USING ERRCODE = '28000';
  END IF;

  PERFORM 1
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = actor
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  FOR SHARE OF p, u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الانضمام إلى القنوات متاح للأعضاء النشطين الموثقين فقط'
      USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'رابط الدعوة غير صالح' USING ERRCODE = '22023';
  END IF;

  SELECT i.id, i.conversation_id, i.expires_at, i.revoked_at, i.max_uses, i.uses_count
  INTO invite_row
  FROM app_private.channel_invites i
  WHERE i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'رابط الدعوة غير صالح'; END IF;
  IF invite_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'تم إلغاء رابط الدعوة'; END IF;
  IF invite_row.expires_at <= now() THEN RAISE EXCEPTION 'انتهت صلاحية رابط الدعوة'; END IF;
  IF invite_row.max_uses IS NOT NULL AND invite_row.uses_count >= invite_row.max_uses THEN
    RAISE EXCEPTION 'اكتمل عدد مرات استخدام رابط الدعوة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = invite_row.conversation_id AND c.type = 'channel'
  ) THEN
    RAISE EXCEPTION 'القناة غير متاحة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = invite_row.conversation_id AND m.user_id = actor
  ) THEN
    RETURN invite_row.conversation_id;
  END IF;

  INSERT INTO public.conversation_members(conversation_id, user_id, role)
  VALUES (invite_row.conversation_id, actor, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count > 0 THEN
    UPDATE app_private.channel_invites
    SET uses_count = uses_count + 1
    WHERE id = invite_row.id;
  END IF;

  RETURN invite_row.conversation_id;
END;
$function$;

-- Ownership transfer is also a privileged role mutation. Lock the caller's
-- eligibility rows and restrict this RPC to actual group conversations.
CREATE OR REPLACE FUNCTION app_private.transfer_group_ownership_impl(
  p_conversation_id uuid,
  p_new_owner uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_owner uuid;
  v_new_role text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM 1
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_actor
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  FOR SHARE OF p, u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نقل ملكية المجموعات متاح للأعضاء النشطين الموثقين فقط'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.type = 'group'
  ) THEN
    RAISE EXCEPTION 'Ownership can only be transferred for group conversations'
      USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO v_owner
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND role = 'owner'
  FOR UPDATE;

  IF v_owner IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the current group owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_new_role
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = p_new_owner
  FOR UPDATE;

  IF v_new_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'The new owner must already be a group administrator'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app_private.owner_transfer', 'on', true);
  UPDATE public.conversation_members
  SET role = 'admin'
  WHERE conversation_id = p_conversation_id AND user_id = v_actor;
  UPDATE public.conversation_members
  SET role = 'owner'
  WHERE conversation_id = p_conversation_id AND user_id = p_new_owner;
  PERFORM set_config('app_private.owner_transfer', 'off', true);

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app_private.owner_transfer', 'off', true);
  RAISE;
END;
$function$;

-- Keep the internal RPC boundary explicit; public wrappers remain SECURITY INVOKER.
REVOKE ALL ON FUNCTION app_private.can_manage_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.create_private_channel(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.create_channel_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.join_channel_by_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.transfer_group_ownership_impl(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION app_private.can_manage_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.create_private_channel(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.create_channel_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.join_channel_by_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.transfer_group_ownership_impl(uuid, uuid) TO authenticated;

COMMIT;
