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
create index message_reactions_user_id_idx
  on public.message_reactions(user_id);

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
