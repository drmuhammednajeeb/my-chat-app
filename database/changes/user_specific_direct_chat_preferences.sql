create table if not exists public.user_chat_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('light','dark')),
  cleared_before timestamptz,
  is_shortcut boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
create index if not exists user_chat_preferences_user_shortcuts_idx
  on public.user_chat_preferences (user_id, is_shortcut) where is_shortcut = true;
create index if not exists user_chat_preferences_conversation_id_idx
  on public.user_chat_preferences (conversation_id);
alter table public.user_chat_preferences enable row level security;
revoke all on table public.user_chat_preferences from anon, authenticated;
grant select, insert, update on table public.user_chat_preferences to authenticated;
drop policy if exists "Users read own direct chat preferences" on public.user_chat_preferences;
create policy "Users read own direct chat preferences"
on public.user_chat_preferences for select to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = user_chat_preferences.conversation_id
    and c.type = 'direct' and cm.user_id = (select auth.uid())
));
drop policy if exists "Users create own direct chat preferences" on public.user_chat_preferences;
create policy "Users create own direct chat preferences"
on public.user_chat_preferences for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = user_chat_preferences.conversation_id
    and c.type = 'direct' and cm.user_id = (select auth.uid())
));
drop policy if exists "Users update own direct chat preferences" on public.user_chat_preferences;
create policy "Users update own direct chat preferences"
on public.user_chat_preferences for update to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = user_chat_preferences.conversation_id
    and c.type = 'direct' and cm.user_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = user_chat_preferences.conversation_id
    and c.type = 'direct' and cm.user_id = (select auth.uid())
));
