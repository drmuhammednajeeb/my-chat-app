drop policy if exists "Members upload their own conversation documents" on public.conversation_documents;
create policy "Members upload their own conversation documents" on public.conversation_documents
 for insert to authenticated with check(owner_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id)
  and (storage.foldername(storage_path))[1]=conversation_id::text
  and (storage.foldername(storage_path))[2]=(select auth.uid())::text);
drop policy if exists "Owners update their conversation documents" on public.conversation_documents;
create policy "Owners update their conversation documents" on public.conversation_documents
 for update to authenticated using(owner_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id))
 with check(owner_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id)
  and (storage.foldername(storage_path))[1]=conversation_id::text
  and (storage.foldername(storage_path))[2]=(select auth.uid())::text);
drop policy if exists "Conversation document owners and shared members read files" on storage.objects;
create policy "Conversation document owners and shared members read files" on storage.objects
 for select to authenticated using(bucket_id='conversation-documents' and exists(select 1 from public.conversation_documents d
  where d.storage_path=name and (storage.foldername(d.storage_path))[2]=d.owner_id::text and storage.objects.owner_id=d.owner_id::text
   and app_private.is_conversation_member(d.conversation_id) and (d.owner_id=(select auth.uid()) or d.visibility='shared')));
drop policy if exists "Sender inserts private reply context" on public.private_reply_contexts;
create policy "Sender inserts private reply context" on public.private_reply_contexts
 for insert to authenticated with check(sender_id=(select auth.uid()) and app_private.is_conversation_member(direct_conversation_id)
  and app_private.is_conversation_member(source_conversation_id)
  and exists(select 1 from public.conversations dc where dc.id=direct_conversation_id and dc.type='direct')
  and exists(select 1 from public.conversations sc where sc.id=source_conversation_id and sc.type='group')
  and exists(select 1 from public.conversation_members recipient where recipient.conversation_id=direct_conversation_id and recipient.user_id=quoted_sender_id)
  and exists(select 1 from public.chat_messages dm where dm.id=direct_message_id and dm.conversation_id=direct_conversation_id and dm.sender_id=(select auth.uid()))
  and exists(select 1 from public.chat_messages sm where sm.id=source_message_id and sm.conversation_id=source_conversation_id and sm.sender_id=quoted_sender_id and sm.deleted_at is null));