-- Per-user message hiding, conversation pins, and server-enforced 15-minute global deletion.
-- Forward-only candidate. This migration is not authorized for production execution.

create table if not exists public.user_hidden_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  hidden_at timestamptz not null default clock_timestamp(),
  constraint user_hidden_messages_pkey primary key (user_id, message_id)
);

create index if not exists user_hidden_messages_user_conversation_idx
  on public.user_hidden_messages (user_id, conversation_id, message_id);

alter table public.user_hidden_messages enable row level security;
revoke all on table public.user_hidden_messages from public, anon, authenticated;
grant select, insert, delete on table public.user_hidden_messages to authenticated;

drop policy if exists "Users read own hidden messages" on public.user_hidden_messages;
create policy "Users read own hidden messages"
  on public.user_hidden_messages for select to authenticated
  using (
    user_id = (select auth.uid())
    and app_private.is_conversation_member(conversation_id)
  );

drop policy if exists "Users hide messages for themselves" on public.user_hidden_messages;
create policy "Users hide messages for themselves"
  on public.user_hidden_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app_private.is_conversation_member(conversation_id)
    and exists (
      select 1
      from public.chat_messages m
      where m.id = message_id
        and m.conversation_id = user_hidden_messages.conversation_id
    )
  );

drop policy if exists "Users unhide own messages" on public.user_hidden_messages;
create policy "Users unhide own messages"
  on public.user_hidden_messages for delete to authenticated
  using (user_id = (select auth.uid()) and app_private.is_conversation_member(conversation_id));

create table if not exists public.user_conversation_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_at timestamptz not null default clock_timestamp(),
  constraint user_conversation_pins_pkey primary key (user_id, conversation_id)
);

create index if not exists user_conversation_pins_user_order_idx
  on public.user_conversation_pins (user_id, pinned_at desc, conversation_id);

alter table public.user_conversation_pins enable row level security;
revoke all on table public.user_conversation_pins from public, anon, authenticated;
grant select, insert, delete on table public.user_conversation_pins to authenticated;

drop policy if exists "Users read own conversation pins" on public.user_conversation_pins;
create policy "Users read own conversation pins"
  on public.user_conversation_pins for select to authenticated
  using (
    user_id = (select auth.uid())
    and app_private.is_conversation_member(conversation_id)
  );

drop policy if exists "Users pin conversations they belong to" on public.user_conversation_pins;
create policy "Users pin conversations they belong to"
  on public.user_conversation_pins for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app_private.is_conversation_member(conversation_id)
  );

drop policy if exists "Users unpin own conversations" on public.user_conversation_pins;
create policy "Users unpin own conversations"
  on public.user_conversation_pins for delete to authenticated
  using (user_id = (select auth.uid()) and app_private.is_conversation_member(conversation_id));

-- Replace the legacy direct soft-delete exception with a narrow transaction-local
-- guard. Message edits continue to use app.allow_message_edit; global deletion
-- must use delete_message_secure and cannot be performed by a direct table UPDATE.
create or replace function public.guard_chat_message_content_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.sender_id is distinct from old.sender_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.reply_to is distinct from old.reply_to then
    raise exception 'Message identity and routing fields are immutable';
  end if;

  if current_setting('app.allow_message_edit', true) = 'on' then
    return new;
  end if;

  if new.content is distinct from old.content
     or new.edited_at is distinct from old.edited_at
     or new.edit_revision is distinct from old.edit_revision
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_type is distinct from old.attachment_type
     or new.deleted_at is distinct from old.deleted_at then
    if current_setting('app.allow_message_delete', true) = 'on'
       and old.deleted_at is null
       and new.deleted_at is not null
       and new.content = 'تم حذف الرسالة'
       and new.edited_at is not distinct from old.edited_at
       and new.edit_revision is not distinct from old.edit_revision
       and new.attachment_path is not distinct from old.attachment_path
       and new.attachment_type is not distinct from old.attachment_type then
      return new;
    end if;

    raise exception 'Message content can only change through secure edit or delete operations';
  end if;

  return new;
end;
$function$;

create or replace function public.delete_message_secure(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_message public.chat_messages;
  v_deleted public.chat_messages;
  v_previous_setting text := current_setting('app.allow_message_delete', true);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_message_id is null then
    raise exception 'Message ID is required';
  end if;

  select *
  into v_message
  from public.chat_messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'Message not found';
  end if;
  if v_message.sender_id <> v_user_id then
    raise exception 'You can only delete your own message for everyone';
  end if;
  if not app_private.is_conversation_member(v_message.conversation_id) then
    raise exception 'You are not an active member of this conversation';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'Message is already deleted';
  end if;
  if clock_timestamp() > v_message.created_at + interval '15 minutes' then
    raise exception 'The 15-minute delete window has expired';
  end if;

  perform set_config('app.allow_message_delete', 'on', true);
  update public.chat_messages
  set deleted_at = clock_timestamp(),
      content = 'تم حذف الرسالة'
  where id = v_message.id
  returning * into v_deleted;

  perform set_config('app.allow_message_delete', coalesce(v_previous_setting, ''), true);
  return v_deleted;
end;
$function$;

revoke all on function public.delete_message_secure(uuid) from public, anon;
grant execute on function public.delete_message_secure(uuid) to authenticated;

comment on table public.user_hidden_messages is
  'Per-user message visibility overrides. Hiding a message never deletes it for other conversation members.';
comment on table public.user_conversation_pins is
  'Per-user pinned conversation ordering, independent of conversation membership and global conversation metadata.';
comment on function public.delete_message_secure(uuid) is
  'Author-only soft deletion within 15 minutes of original message creation; enforced using the database clock.';
