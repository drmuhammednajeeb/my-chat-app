-- Reconstructed from the live production catalog on 2026-11-12.
-- Production version: 20261107160647 / channel_visibility_avatar_group_background.
-- Original SQL body was not present in Git history or the supplied project records.
-- Reconstructs inspected channel columns, private RPC implementations, channel avatar
-- bucket, storage policies, and private-function ACLs for disposable clean bootstrap.
-- Do not apply to production: this version is already present in the production ledger.

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_path text;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_type_check,
  DROP CONSTRAINT IF EXISTS conversations_check,
  DROP CONSTRAINT IF EXISTS conversations_description_length_check,
  DROP CONSTRAINT IF EXISTS conversations_only_channels_public;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_type_check
    CHECK (type = ANY (ARRAY['direct','group','channel'])),
  ADD CONSTRAINT conversations_check
    CHECK (
      (type = 'direct' AND title IS NULL)
      OR (type IN ('group','channel') AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 80)
    ),
  ADD CONSTRAINT conversations_description_length_check
    CHECK (char_length(description) <= 500),
  ADD CONSTRAINT conversations_only_channels_public
    CHECK ((type = 'channel') OR (is_public = false));
ALTER TABLE public.conversation_group_settings
  ADD COLUMN IF NOT EXISTS background_theme text NOT NULL DEFAULT 'default';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('channel-avatars', 'channel-avatars', false, 3145728, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.can_access_channel_avatar(target_conversation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.is_active_member()
     and exists (
       select 1
         from public.conversations c
        where c.id = target_conversation
          and c.type = 'channel'
          and (
            c.is_public = true
            or exists (
              select 1 from public.conversation_members m
               where m.conversation_id = c.id
                 and m.user_id = (select auth.uid())
            )
          )
     );
$function$;
REVOKE ALL ON FUNCTION app_private.can_access_channel_avatar(target_conversation uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_channel_avatar(target_conversation uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.create_channel(p_title text, p_description text DEFAULT ''::text, p_is_public boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  new_id uuid;
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'اسم القناة يجب أن يكون بين 1 و80 حرفاً';
  end if;
  if coalesce(char_length(p_description), 0) > 500 then
    raise exception 'وصف القناة يتجاوز 500 حرف';
  end if;

  insert into public.conversations(type,title,description,is_public,created_by)
  values ('channel',btrim(p_title),coalesce(btrim(p_description),''),coalesce(p_is_public,false),actor)
  returning id into new_id;

  insert into public.conversation_members(conversation_id,user_id,role)
  values (new_id,actor,'owner');

  return new_id;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.create_channel(p_title text, p_description text, p_is_public boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.create_channel(p_title text, p_description text, p_is_public boolean) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.discover_public_channels(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, description text, avatar_path text, member_count bigint, is_member boolean, created_at timestamp with time zone, is_public boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  return query
  select c.id,c.title,c.description,c.avatar_path,
         count(m.user_id)::bigint,
         coalesce(bool_or(m.user_id = actor),false),
         c.created_at,c.is_public
    from public.conversations c
    left join public.conversation_members m on m.conversation_id = c.id
   where c.type = 'channel'
     and c.is_public = true
     and (
       nullif(btrim(p_search),'') is null
       or c.title ilike '%' || btrim(p_search) || '%'
       or c.description ilike '%' || btrim(p_search) || '%'
     )
   group by c.id
   order by c.created_at desc
   limit greatest(1,least(coalesce(p_limit,40),100))
   offset greatest(coalesce(p_offset,0),0);
end;
$function$;
REVOKE ALL ON FUNCTION app_private.discover_public_channels(p_search text, p_limit integer, p_offset integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.discover_public_channels(p_search text, p_limit integer, p_offset integer) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.join_public_channel(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and c.type = 'channel'
       and c.is_public = true
  ) then
    raise exception 'القناة غير عامة أو غير متاحة';
  end if;
  insert into public.conversation_members(conversation_id,user_id,role)
  values (p_conversation_id,actor,'member')
  on conflict (conversation_id,user_id) do nothing;
  return p_conversation_id;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.join_public_channel(p_conversation_id uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.join_public_channel(p_conversation_id uuid) TO authenticated;

DROP POLICY IF EXISTS "Channel admins delete channel avatars" ON storage.objects;
CREATE POLICY "Channel admins delete channel avatars" ON storage.objects FOR DELETE TO authenticated
USING ((bucket_id = 'channel-avatars'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid) AND ( SELECT app_private.is_active_member() AS is_active_member));

DROP POLICY IF EXISTS "Channel admins update channel avatars" ON storage.objects;
CREATE POLICY "Channel admins update channel avatars" ON storage.objects FOR UPDATE TO authenticated
USING ((bucket_id = 'channel-avatars'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid) AND ( SELECT app_private.is_active_member() AS is_active_member))
WITH CHECK ((bucket_id = 'channel-avatars'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid) AND ( SELECT app_private.is_active_member() AS is_active_member));

DROP POLICY IF EXISTS "Channel admins upload channel avatars" ON storage.objects;
CREATE POLICY "Channel admins upload channel avatars" ON storage.objects FOR INSERT TO authenticated
WITH CHECK ((bucket_id = 'channel-avatars'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid) AND ( SELECT app_private.is_active_member() AS is_active_member));

DROP POLICY IF EXISTS "Channel members read channel avatars" ON storage.objects;
CREATE POLICY "Channel members read channel avatars" ON storage.objects FOR SELECT TO authenticated
USING ((bucket_id = 'channel-avatars'::text) AND app_private.can_access_channel_avatar(((storage.foldername(name))[1])::uuid));

COMMIT;
