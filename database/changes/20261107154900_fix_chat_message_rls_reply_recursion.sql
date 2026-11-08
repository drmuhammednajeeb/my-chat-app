-- Prevent chat_messages RLS recursion by moving self-table reply validation
-- out of policy expressions and into a SECURITY DEFINER trigger.

create or replace function app_private.enforce_chat_message_reply_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.reply_to is null then
    return new;
  end if;

  if new.conversation_id is null
     or not exists (
       select 1
       from public.chat_messages parent
       where parent.id = new.reply_to
         and parent.conversation_id = new.conversation_id
         and parent.deleted_at is null
     ) then
    raise exception 'Reply target must be an existing, non-deleted message in the same conversation';
  end if;

  return new;
end;
$function$;

revoke all on function app_private.enforce_chat_message_reply_parent() from public, anon;
grant execute on function app_private.enforce_chat_message_reply_parent() to authenticated;

drop trigger if exists enforce_chat_message_reply_parent on public.chat_messages;
create trigger enforce_chat_message_reply_parent
before insert or update of reply_to on public.chat_messages
for each row execute function app_private.enforce_chat_message_reply_parent();

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves"
on public.chat_messages
for insert
to authenticated
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
    not exists (
      select 1
      from public.conversations c
      join public.conversation_group_settings gs on gs.conversation_id = c.id
      where c.id = chat_messages.conversation_id
        and c.type = 'group'
        and gs.only_admins_can_send
    )
    or app_private.can_manage_conversation(conversation_id)
    or (select app_private.is_team_admin())
  )
  and (select app_private.is_active_member())
);

drop policy if exists "Authors edit own messages" on public.chat_messages;
create policy "Authors edit own messages"
on public.chat_messages
for update
to authenticated
using (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (select app_private.is_active_member())
)
with check (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (select app_private.is_active_member())
);
