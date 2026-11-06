-- Private-by-default channels with bearer invite links.
-- Channel content remains protected by conversation membership RLS.
CREATE TABLE IF NOT EXISTS app_private.channel_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0)
);
ALTER TABLE app_private.channel_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.channel_invites FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS channel_invites_conversation_active_idx
  ON app_private.channel_invites(conversation_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION app_private.create_private_channel(p_title text, p_description text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE new_id uuid; actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول لإنشاء قناة'; END IF;
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

CREATE OR REPLACE FUNCTION app_private.create_channel_invite(p_conversation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE actor uuid := (SELECT auth.uid()); token text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT app_private.can_manage_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية مشاركة هذه القناة' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id=p_conversation_id AND c.type='channel') THEN
    RAISE EXCEPTION 'القناة غير موجودة';
  END IF;
  UPDATE app_private.channel_invites SET revoked_at=now()
   WHERE conversation_id=p_conversation_id AND revoked_at IS NULL;
  token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO app_private.channel_invites(conversation_id,token_hash,created_by,expires_at)
  VALUES (p_conversation_id,encode(extensions.digest(token,'sha256'),'hex'),actor,now()+interval '7 days');
  RETURN token;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.join_channel_by_invite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE actor uuid := (SELECT auth.uid()); invite_row record; inserted_count integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'رابط الدعوة غير صالح' USING ERRCODE='22023';
  END IF;
  SELECT i.id,i.conversation_id,i.expires_at,i.revoked_at,i.max_uses,i.uses_count
    INTO invite_row FROM app_private.channel_invites i
   WHERE i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'رابط الدعوة غير صالح'; END IF;
  IF invite_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'تم إلغاء رابط الدعوة'; END IF;
  IF invite_row.expires_at<=now() THEN RAISE EXCEPTION 'انتهت صلاحية رابط الدعوة'; END IF;
  IF invite_row.max_uses IS NOT NULL AND invite_row.uses_count>=invite_row.max_uses THEN
    RAISE EXCEPTION 'اكتمل عدد مرات استخدام رابط الدعوة';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id=invite_row.conversation_id AND c.type='channel') THEN
    RAISE EXCEPTION 'القناة غير متاحة';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=invite_row.conversation_id AND m.user_id=actor) THEN
    RETURN invite_row.conversation_id;
  END IF;
  INSERT INTO public.conversation_members(conversation_id,user_id,role)
  VALUES (invite_row.conversation_id,actor,'member') ON CONFLICT(conversation_id,user_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count>0 THEN
    UPDATE app_private.channel_invites SET uses_count=uses_count+1 WHERE id=invite_row.id;
  END IF;
  RETURN invite_row.conversation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_private_channel(p_title text,p_description text DEFAULT '')
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT app_private.create_private_channel(p_title,p_description); $function$;
CREATE OR REPLACE FUNCTION public.create_channel_invite(p_conversation_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT app_private.create_channel_invite(p_conversation_id); $function$;
CREATE OR REPLACE FUNCTION public.join_channel_by_invite(p_token text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT app_private.join_channel_by_invite(p_token); $function$;

GRANT USAGE ON SCHEMA app_private TO authenticated;
REVOKE ALL ON FUNCTION app_private.create_private_channel(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION app_private.create_channel_invite(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION app_private.join_channel_by_invite(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.create_private_channel(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.create_channel_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.join_channel_by_invite(text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_private_channel(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_channel_invite(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.join_channel_by_invite(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_private_channel(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_channel_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_channel_by_invite(text) TO authenticated;

DROP FUNCTION IF EXISTS public.create_public_channel(text,text);
DROP POLICY IF EXISTS "Members can view conversations" ON public.conversations;
CREATE POLICY "Members can view conversations" ON public.conversations FOR SELECT TO authenticated
USING (app_private.is_conversation_member(id) OR (SELECT app_private.is_team_admin()));
DROP POLICY IF EXISTS "Authenticated users create conversations" ON public.conversations;
CREATE POLICY "Authenticated users create conversations" ON public.conversations FOR INSERT TO authenticated
WITH CHECK (created_by=(SELECT auth.uid()) AND type=ANY(ARRAY['direct'::text,'group'::text]));
DROP POLICY IF EXISTS "Creator adds first member" ON public.conversation_members;
CREATE POLICY "Creator adds first member" ON public.conversation_members FOR INSERT TO authenticated
WITH CHECK (
  (user_id=(SELECT auth.uid()) AND role='owner' AND app_private.is_conversation_creator(conversation_id))
  OR (role='member' AND app_private.can_manage_conversation(conversation_id))
  OR (SELECT app_private.is_team_admin())
);
UPDATE public.conversations SET is_public=false WHERE type='channel' AND is_public IS DISTINCT FROM false;
