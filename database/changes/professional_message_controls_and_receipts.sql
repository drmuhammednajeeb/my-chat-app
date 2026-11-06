-- Professional chat: reply integrity, pins, delivery receipts.
alter table public.conversation_members
  add column if not exists last_delivered_at timestamptz;

create table public.message_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);
create index message_pins_conversation_pinned_at_idx on public.message_pins(conversation_id, pinned_at desc);
create index message_pins_message_idx on public.message_pins(message_id);
alter table public.message_pins enable row level security;
alter table public.message_pins replica identity full;
grant select, insert, delete on public.message_pins to authenticated;

create policy "Conversation members read pinned messages"
on public.message_pins for select to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_pins.message_id
      and m.conversation_id = message_pins.conversation_id
      and m.deleted_at is null
  )
);
create policy "Members pin messages in their conversations"
on public.message_pins for insert to authenticated
with check (
  pinned_by = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_pins.message_id
      and m.conversation_id = message_pins.conversation_id
      and m.deleted_at is null
  )
);
create policy "Owners remove pins or members remove their own"
on public.message_pins for delete to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and (
    pinned_by = (select auth.uid())
    or app_private.can_manage_conversation(conversation_id)
    or (select app_private.is_team_admin())
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
      where c.id = chat_messages.conversation_id and c.type = 'channel'
    )
    or app_private.can_manage_conversation(conversation_id)
  )
  and (
    reply_to is null
    or exists (
      select 1 from public.chat_messages parent
      where parent.id = chat_messages.reply_to
        and parent.conversation_id = chat_messages.conversation_id
        and parent.deleted_at is null
    )
  )
);

drop policy if exists "Authors edit own messages" on public.chat_messages;
create policy "Authors edit own messages"
on public.chat_messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
)
with check (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (
    reply_to is null
    or exists (
      select 1 from public.chat_messages parent
      where parent.id = chat_messages.reply_to
        and parent.conversation_id = chat_messages.conversation_id
        and parent.deleted_at is null
    )
  )
);

alter publication supabase_realtime add table public.message_pins;
alter publication supabase_realtime add table public.conversation_members;

create index if not exists message_pins_pinned_by_idx on public.message_pins(pinned_by);
