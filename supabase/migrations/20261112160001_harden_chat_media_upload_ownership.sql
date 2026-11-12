-- Forward reconciliation: prevent authenticated members from uploading into another user's chat-media path.
-- Preserves conversation membership while binding path segment 2 to the authenticated uploader.

BEGIN;

DROP POLICY IF EXISTS "Conversation members upload chat media" ON storage.objects;
CREATE POLICY "Conversation members upload chat media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND (SELECT app_private.is_conversation_member(((storage.foldername(name))[1])::uuid))
  AND (SELECT app_private.is_active_member())
);

COMMIT;
