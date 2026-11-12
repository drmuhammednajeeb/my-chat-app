
drop policy if exists "Members read group settings" on public.conversation_group_settings;
create policy "Members and team admins read group settings" on public.conversation_group_settings for select to authenticated
using (app_private.is_conversation_member(conversation_id) or (select app_private.is_team_admin()));

drop policy if exists "Group admins insert settings" on public.conversation_group_settings;
create policy "Group admins insert settings" on public.conversation_group_settings for insert to authenticated
with check (app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()));
drop policy if exists "Group admins update settings" on public.conversation_group_settings;
create policy "Group admins update settings" on public.conversation_group_settings for update to authenticated
using (app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()))
with check (app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()));
drop policy if exists "Group admins delete settings" on public.conversation_group_settings;
create policy "Group admins delete settings" on public.conversation_group_settings for delete to authenticated
using (app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()));

drop policy if exists "Owners update conversations" on public.conversations;
create policy "Owners and group admins update conversations" on public.conversations for update to authenticated
using (created_by=(select auth.uid()) or app_private.can_manage_conversation(id) or (select app_private.is_team_admin()))
with check (created_by=(select auth.uid()) or app_private.can_manage_conversation(id) or (select app_private.is_team_admin()));

drop policy if exists "Members read membership history" on public.conversation_member_events;
create policy "Members and team admins read membership history" on public.conversation_member_events for select to authenticated
using (app_private.is_conversation_member(conversation_id) or (select app_private.is_team_admin()));

create or replace function app_private.guard_group_member_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transfer boolean := coalesce(current_setting('app_private.owner_transfer', true),'off')='on';
  v_team_admin boolean := app_private.is_team_admin();
begin
  if old.role is distinct from new.role then
    if not app_private.can_manage_conversation(old.conversation_id) and not v_team_admin then
      raise exception 'Only group administrators can change member roles' using errcode='42501';
    end if;
    if old.role='owner' and not (v_transfer and auth.uid()=old.user_id) and not v_team_admin then
      raise exception 'The group owner role can only be transferred by its owner' using errcode='42501';
    end if;
    if new.role='owner' and not v_transfer and not v_team_admin then
      raise exception 'Only an authorized ownership transfer can assign ownership' using errcode='42501';
    end if;
  end if;
  if old.user_id is distinct from new.user_id or old.conversation_id is distinct from new.conversation_id then
    raise exception 'Membership identity cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$$;

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves" on public.chat_messages for insert to authenticated
with check (
 sender_id=(select auth.uid())
 and app_private.is_conversation_member(conversation_id)
 and (
   not exists(select 1 from public.conversations c where c.id=chat_messages.conversation_id and c.type='channel')
   or app_private.can_manage_conversation(conversation_id)
   or (select app_private.is_team_admin())
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
