-- TEST ONLY: partial catalog-derived reconstruction for channel-avatar RLS.
-- This is NOT the missing historical migration 20261107160647 and does not reconstruct
-- group-background behavior. It exists only to exercise the deployed channel-avatar
-- bucket, helper function, and four Storage policies in disposable local Supabase.
BEGIN;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'channel-avatars',
  'channel-avatars',
  false,
  3145728,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name=EXCLUDED.name,
    public=EXCLUDED.public,
    file_size_limit=EXCLUDED.file_size_limit,
    allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION app_private.can_access_channel_avatar(target_conversation uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.is_active_member()
     AND EXISTS (
       SELECT 1
         FROM public.conversations c
        WHERE c.id = target_conversation
          AND c.type = 'channel'
          AND (
            c.is_public = true
            OR EXISTS (
              SELECT 1
                FROM public.conversation_members m
               WHERE m.conversation_id = c.id
                 AND m.user_id = (SELECT auth.uid())
            )
          )
     );
$function$;

REVOKE ALL ON FUNCTION app_private.can_access_channel_avatar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_channel_avatar(uuid) TO authenticated, postgres;

DROP POLICY IF EXISTS "Channel members read channel avatars" ON storage.objects;
CREATE POLICY "Channel members read channel avatars"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND app_private.can_access_channel_avatar(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Channel admins upload channel avatars" ON storage.objects;
CREATE POLICY "Channel admins upload channel avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  AND (SELECT app_private.is_active_member())
);

DROP POLICY IF EXISTS "Channel admins update channel avatars" ON storage.objects;
CREATE POLICY "Channel admins update channel avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  AND (SELECT app_private.is_active_member())
)
WITH CHECK (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  AND (SELECT app_private.is_active_member())
);

DROP POLICY IF EXISTS "Channel admins delete channel avatars" ON storage.objects;
CREATE POLICY "Channel admins delete channel avatars"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  AND (SELECT app_private.is_active_member())
);

COMMIT;
