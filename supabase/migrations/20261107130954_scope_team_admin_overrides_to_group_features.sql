
drop policy if exists "Owners and group admins update conversations" on public.conversations;
create policy "Owners and group admins update conversations" on public.conversations for update to authenticated
using (
  created_by=(select auth.uid())
  or app_private.can_manage_conversation(id)
  or ((select app_private.is_team_admin()) and type='group')
)
with check (
  created_by=(select auth.uid())
  or app_private.can_manage_conversation(id)
  or ((select app_private.is_team_admin()) and type='group')
);

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves" on public.chat_messages for insert to authenticated
with check (
 sender_id=(select auth.uid())
 and app_private.is_conversation_member(conversation_id)
 and (
   not exists(select 1 from public.conversations c where c.id=chat_messages.conversation_id and c.type='channel')
   or app_private.can_manage_conversation(conversation_id)
 )
 and (
   not exists(select 1 from public.conversations c join public.conversation_group_settings gs on gs.conversation_id=c.id
     where c.id=chat_messages.conversation_id and c.type='group' and gs.only_admins_can_send)
   or app_private.can_manage_conversation(conversation_id)
   or (select app_private.is_team_admin())
 )
 and (
   reply_to is null or exists(select 1 from public.chat_messages parent
     where parent.id=chat_messages.reply_to and parent.conversation_id=chat_messages.conversation_id and parent.deleted_at is null)
 )
);
