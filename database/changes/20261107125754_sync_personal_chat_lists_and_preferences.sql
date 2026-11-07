
create unique index if not exists conversation_members_one_owner_idx
  on public.conversation_members(conversation_id) where role='owner';

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_lists') then
      alter publication supabase_realtime add table public.chat_lists;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_list_items') then
      alter publication supabase_realtime add table public.chat_list_items;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_conversation_settings') then
      alter publication supabase_realtime add table public.user_conversation_settings;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_message_stars') then
      alter publication supabase_realtime add table public.user_message_stars;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_chat_preferences') then
      alter publication supabase_realtime add table public.user_chat_preferences;
    end if;
  end if;
end $$;
