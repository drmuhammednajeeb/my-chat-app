-- TEST-ONLY CANDIDATE POLICIES.
-- Derived from the browser upload path: conversation UUID / uploader UUID / generated filename.
-- These are not asserted to match any policy that may already exist in a deployed project.
drop policy if exists "Test-only conversation members upload own chat media" on storage.objects;
create policy "Test-only conversation members upload own chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then app_private.is_conversation_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "Test-only conversation members read chat media" on storage.objects;
create policy "Test-only conversation members read chat media"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then app_private.is_conversation_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);
