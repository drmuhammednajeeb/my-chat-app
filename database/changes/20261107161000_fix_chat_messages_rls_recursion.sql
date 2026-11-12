-- Fix infinite RLS recursion when validating reply_to references.
-- The policy must not query chat_messages directly; use a narrowly scoped
-- SECURITY DEFINER predicate that returns only a boolean and enforces membership.

create or replace function app_private.is_valid_reply_parent(
  target_message uuid,
  target_conversation uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    target_message is not null
    and target_conversation is not null
    and app_private.is_active_member()
    and app_private.is_conversation_member(target_conversation)
    and exists (
      select 1
      from public.chat_messages parent
      where parent.id = target_message
        and parent.conversation_id = target_conversation
        and parent.deleted_at is null
    );
$function$;

revoke all on function app_private.is_valid_reply_parent(uuid, uuid) from public;
revoke all on function app_private.is_valid_reply_parent(uuid, uuid) from anon;
grant execute on function app_private.is_valid_reply_parent(uuid, uuid) to authenticated;

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
  and (
    reply_to is null
    or app_private.is_valid_reply_parent(reply_to, conversation_id)
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
  and (
    reply_to is null
    or app_private.is_valid_reply_parent(reply_to, conversation_id)
  )
  and (select app_private.is_active_member())
);
