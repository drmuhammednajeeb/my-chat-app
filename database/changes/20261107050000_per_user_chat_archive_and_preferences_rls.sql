-- Per-user archive state for every conversation type.
-- Existing conversation messages and membership rows are never deleted.
alter table public.user_chat_preferences
  add column if not exists is_archived boolean not null default false;

create index if not exists user_chat_preferences_archived_user_idx
  on public.user_chat_preferences (user_id, updated_at desc)
  where is_archived = true;

drop policy if exists "Users create own direct chat preferences" on public.user_chat_preferences;
drop policy if exists "Users read own direct chat preferences" on public.user_chat_preferences;
drop policy if exists "Users update own direct chat preferences" on public.user_chat_preferences;

create policy "Users create own conversation preferences"
on public.user_chat_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = user_chat_preferences.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

create policy "Users read own conversation preferences"
on public.user_chat_preferences for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = user_chat_preferences.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

create policy "Users update own conversation preferences"
on public.user_chat_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = user_chat_preferences.conversation_id
      and cm.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = user_chat_preferences.conversation_id
      and cm.user_id = (select auth.uid())
  )
);
