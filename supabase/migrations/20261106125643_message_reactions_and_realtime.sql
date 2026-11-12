-- Public announcement channels for Ultra Chat Pro.
-- Channels reuse the existing conversations, conversation_members and chat_messages model.
begin;

alter table public.conversations
  drop constraint if exists conversations_type_check,
  drop constraint if exists conversations_check;

alter table public.conversations
  add constraint conversations_type_check
    check (type in ('direct','group','channel')),
  add constraint conversations_check
    check (
      (type = 'direct' and title is null)
      or (type in ('group','channel') and title is not null and char_length(btrim(title)) between 1 and 80)
    );

alter table public.conversations
  add column if not exists description text not null default '',
  add column if not exists is_public boolean not null default true;

alter table public.conversations
  add constraint conversations_description_length_check
    check (char_length(description) <= 500);

drop policy if exists "Authenticated users create conversations" on public.conversations;
create policy "Authenticated users create conversations"
on public.conversations for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    type in ('direct','group')
    or (type = 'channel' and is_public = true)
  )
);

drop policy if exists "Members can view conversations" on public.conversations;
create policy "Members can view conversations"
on public.conversations for select to authenticated
using (
  app_private.is_conversation_member(id)
  or (type = 'channel' and is_public = true)
);

drop policy if exists "Users can join public channels" on public.conversation_members;
drop policy if exists "Creator adds first member" on public.conversation_members;
create policy "Creator adds first member"
on public.conversation_members for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and role = 'owner'
    and app_private.is_conversation_creator(conversation_id)
  )
  or (
    role = 'member'
    and app_private.can_manage_conversation(conversation_id)
  )
  or (
    user_id = (select auth.uid())
    and role = 'member'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.type = 'channel'
        and c.is_public = true
    )
  )
);

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves"
on public.chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (
    not exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.type = 'channel'
    )
    or app_private.can_manage_conversation(conversation_id)
  )
);

grant select, insert, update on public.conversations to authenticated;
grant select, insert, update, delete on public.conversation_members to authenticated;
grant select, insert, update on public.chat_messages to authenticated;

create or replace function public.create_public_channel(p_title text, p_description text default '')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'يجب تسجيل الدخول لإنشاء قناة';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'اسم القناة يجب أن يكون بين 1 و80 حرفاً';
  end if;
  if coalesce(char_length(p_description),0) > 500 then
    raise exception 'وصف القناة يتجاوز 500 حرف';
  end if;

  insert into public.conversations(type,title,description,is_public,created_by)
  values ('channel',btrim(p_title),coalesce(btrim(p_description),''),true,actor)
  returning id into new_id;

  insert into public.conversation_members(conversation_id,user_id,role)
  values (new_id,actor,'owner');

  return new_id;
end;
$$;

revoke all on function public.create_public_channel(text,text) from public, anon;
grant execute on function public.create_public_channel(text,text) to authenticated;

-- Message reactions: base table, RLS and realtime publication.
-- Message reactions for direct chats, groups, and public announcement channels.
-- One reaction per member per message; users may toggle between like and heart.
create table public.message_reactions (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like','heart')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_conversation_idx
  on public.message_reactions(conversation_id, message_id);


alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;
grant select, insert, update, delete on public.message_reactions to authenticated;

create policy "Conversation members read message reactions"
on public.message_reactions for select to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_reactions.message_id
      and m.conversation_id = message_reactions.conversation_id
  )
);

create policy "Members add own message reactions"
on public.message_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_reactions.message_id
      and m.conversation_id = message_reactions.conversation_id
      and m.deleted_at is null
  )
);

create policy "Members update own message reactions"
on public.message_reactions for update to authenticated
using (
  user_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
)
with check (
  user_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_reactions.message_id
      and m.conversation_id = message_reactions.conversation_id
      and m.deleted_at is null
  )
);

create policy "Members remove own message reactions"
on public.message_reactions for delete to authenticated
using (
  user_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
);

alter publication supabase_realtime add table public.message_reactions;

commit;
