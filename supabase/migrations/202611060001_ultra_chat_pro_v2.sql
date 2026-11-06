-- Ultra Chat Pro 2.0: authenticated conversation model
-- Preserve the old messages table but disable its anonymous/public access.
begin;
drop policy if exists "Enable all access" on public.messages;
revoke all on table public.messages from anon, authenticated;
alter table public.messages enable row level security;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
 display_name text not null check (char_length(display_name) between 1 and 48),
 avatar_url text, bio text not null default '' check (char_length(bio)<=160),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 type text not null check(type in ('direct','group')), title text,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 last_message_at timestamptz not null default now(),
 check((type='direct' and title is null) or type='group')
);
create table if not exists public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('owner','admin','member')),
 joined_at timestamptz not null default now(), last_read_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
create table if not exists public.chat_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete restrict,
 content text not null default '' check(char_length(content)<=5000),
 attachment_path text, attachment_type text,
 reply_to uuid references public.chat_messages(id) on delete set null,
 edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(),
 check(char_length(content)>0 or attachment_path is not null)
);
create index if not exists conversations_last_message_idx on public.conversations(last_message_at desc);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id,joined_at desc);
create index if not exists chat_messages_conversation_created_idx on public.chat_messages(conversation_id,created_at desc);
create index if not exists chat_messages_sender_idx on public.chat_messages(sender_id,created_at desc);

create or replace function app_private.is_conversation_member(target_conversation uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.conversation_members cm where cm.conversation_id=target_conversation and cm.user_id=(select auth.uid())) $$;
create or replace function app_private.can_manage_conversation(target_conversation uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.conversation_members cm where cm.conversation_id=target_conversation and cm.user_id=(select auth.uid()) and cm.role in ('owner','admin')) $$;
revoke all on function app_private.is_conversation_member(uuid) from public, anon;
revoke all on function app_private.can_manage_conversation(uuid) from public, anon;
grant execute on function app_private.is_conversation_member(uuid) to authenticated;
grant execute on function app_private.can_manage_conversation(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Profiles visible to authenticated users" on public.profiles;
create policy "Profiles visible to authenticated users" on public.profiles for select to authenticated using(true);
drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated with check((select auth.uid())=id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);

drop policy if exists "Members can view conversations" on public.conversations;
create policy "Members can view conversations" on public.conversations for select to authenticated using(app_private.is_conversation_member(id));
drop policy if exists "Authenticated users create conversations" on public.conversations;
create policy "Authenticated users create conversations" on public.conversations for insert to authenticated with check(created_by=(select auth.uid()));
drop policy if exists "Owners update conversations" on public.conversations;
create policy "Owners update conversations" on public.conversations for update to authenticated using(created_by=(select auth.uid())) with check(created_by=(select auth.uid()));

drop policy if exists "Members view membership" on public.conversation_members;
create policy "Members view membership" on public.conversation_members for select to authenticated using(app_private.is_conversation_member(conversation_id));
drop policy if exists "Creator adds first member" on public.conversation_members;
create policy "Creator adds first member" on public.conversation_members for insert to authenticated with check(
 (user_id=(select auth.uid()) and exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=(select auth.uid())))
 or app_private.can_manage_conversation(conversation_id)
);
drop policy if exists "Members update own read state" on public.conversation_members;
create policy "Members update own read state" on public.conversation_members for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists "Members leave or admins remove" on public.conversation_members;
create policy "Members leave or admins remove" on public.conversation_members for delete to authenticated using(user_id=(select auth.uid()) or app_private.can_manage_conversation(conversation_id));

drop policy if exists "Conversation members read messages" on public.chat_messages;
create policy "Conversation members read messages" on public.chat_messages for select to authenticated using(app_private.is_conversation_member(conversation_id));
drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves" on public.chat_messages for insert to authenticated with check(sender_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id));
drop policy if exists "Authors edit own messages" on public.chat_messages;
create policy "Authors edit own messages" on public.chat_messages for update to authenticated using(sender_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id)) with check(sender_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id));

grant select,insert,update on public.profiles to authenticated;
grant select,insert,update on public.conversations to authenticated;
grant select,insert,update,delete on public.conversation_members to authenticated;
grant select,insert,update on public.chat_messages to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-media','chat-media',false,12582912,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict(id) do nothing;
drop policy if exists "Conversation members read chat media" on storage.objects;
create policy "Conversation members read chat media" on storage.objects for select to authenticated using(bucket_id='chat-media' and app_private.is_conversation_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "Conversation members upload chat media" on storage.objects;
create policy "Conversation members upload chat media" on storage.objects for insert to authenticated with check(bucket_id='chat-media' and app_private.is_conversation_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "Owners delete chat media" on storage.objects;
create policy "Owners delete chat media" on storage.objects for delete to authenticated using(bucket_id='chat-media' and owner_id=(select auth.uid())::text);

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
  alter publication supabase_realtime add table public.chat_messages;
 end if;
end $$;
commit;