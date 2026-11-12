drop policy if exists "Users manage their private conversation notes" on public.private_conversation_notes;
create policy "Users manage their private conversation notes" on public.private_conversation_notes
 for all to authenticated
 using (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id))
 with check (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id)
   and (responsible_user_id is null or exists(select 1 from public.conversation_members cm where cm.conversation_id=private_conversation_notes.conversation_id and cm.user_id=private_conversation_notes.responsible_user_id)));

do $$
declare t text;
begin
 foreach t in array array['user_conversation_labels','user_conversation_label_items','user_conversation_classifications','user_classification_rules','private_conversation_notes','conversation_documents','private_reply_contexts'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;