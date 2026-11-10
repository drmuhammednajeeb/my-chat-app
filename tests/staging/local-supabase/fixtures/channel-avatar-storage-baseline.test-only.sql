-- TEST ONLY. Restore the reviewed production channel-avatar helper and policies
-- because they are present in Production but absent from the selected SQL replay sources.
-- This fixture is guarded and must never be used as a production migration.
DO $guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('app.test_only_local_replay', true) <> 'enabled' THEN
    RAISE EXCEPTION 'Refusing channel-avatar baseline fixture outside guarded local replay';
  END IF;
END;
$guard$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'channel-avatars',
  'channel-avatars',
  false,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION app_private.can_access_channel_avatar(target_conversation uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce(app_private.is_active_member(), false)
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = target_conversation
        AND c.type = 'channel'
        AND (
          c.is_public = true
          OR EXISTS (
            SELECT 1
            FROM public.conversation_members cm
            WHERE cm.conversation_id = c.id
              AND cm.user_id = (SELECT auth.uid())
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION app_private.can_access_channel_avatar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_access_channel_avatar(uuid) TO authenticated;

DROP POLICY IF EXISTS "Channel members read channel avatars" ON storage.objects;
CREATE POLICY "Channel members read channel avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND app_private.can_access_channel_avatar((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Channel admins upload channel avatars" ON storage.objects;
CREATE POLICY "Channel admins upload channel avatars"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation((storage.foldername(name))[1]::uuid)
  AND (SELECT app_private.is_active_member())
);

DROP POLICY IF EXISTS "Channel admins update channel avatars" ON storage.objects;
CREATE POLICY "Channel admins update channel avatars"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation((storage.foldername(name))[1]::uuid)
  AND (SELECT app_private.is_active_member())
)
WITH CHECK (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation((storage.foldername(name))[1]::uuid)
  AND (SELECT app_private.is_active_member())
);

DROP POLICY IF EXISTS "Channel admins delete channel avatars" ON storage.objects;
CREATE POLICY "Channel admins delete channel avatars"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'channel-avatars'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND app_private.can_manage_conversation((storage.foldername(name))[1]::uuid)
  AND (SELECT app_private.is_active_member())
);

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'channel-avatars' AND public = false
      AND file_size_limit = 3145728
      AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp']
  ) THEN
    RAISE EXCEPTION 'channel-avatars bucket does not match the private production baseline';
  END IF;
  IF NOT has_function_privilege('authenticated', 'app_private.can_access_channel_avatar(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'app_private.can_access_channel_avatar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'channel-avatar helper function ACL is not least-privilege';
  END IF;
END;
$assert$;
