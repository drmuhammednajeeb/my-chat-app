-- Preserve public-channel avatar reads without relying on a caller-visible conversations subquery.
-- The helper is SECURITY DEFINER and enforces active membership plus public-channel/member visibility.
BEGIN;

DROP POLICY IF EXISTS "Conversation members read conversation avatars" ON storage.objects;

CREATE POLICY "Conversation members read conversation avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'conversation-avatars'
  AND app_private.is_active_member()
  AND (
    app_private.is_conversation_member(((storage.foldername(name))[1])::uuid)
    OR app_private.can_access_channel_avatar(((storage.foldername(name))[1])::uuid)
  )
);

COMMIT;
