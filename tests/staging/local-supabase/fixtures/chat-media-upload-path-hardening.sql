-- TEST-ONLY SECURITY HARDENING CANDIDATE.
-- Replaces the canonical chat-media INSERT policy and adds an uploader-folder ownership check.
-- The canonical policy checks conversation membership but does not bind path segment 2 to auth.uid().
drop policy if exists "Conversation members upload chat media" on storage.objects;
create policy "Conversation members upload chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.is_conversation_member(((storage.foldername(name))[1])::uuid)
);
