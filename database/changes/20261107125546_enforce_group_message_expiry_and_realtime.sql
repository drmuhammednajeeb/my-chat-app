
drop policy if exists "Conversation members read messages" on public.chat_messages;
create policy "Conversation members read messages" on public.chat_messages for select to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and (expires_at is null or expires_at > now())
);

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_group_settings') then
    alter publication supabase_realtime add table public.conversation_group_settings;
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_member_events') then
    alter publication supabase_realtime add table public.conversation_member_events;
  end if;
end $$;
