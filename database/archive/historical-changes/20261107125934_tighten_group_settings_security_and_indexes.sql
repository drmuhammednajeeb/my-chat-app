
drop policy if exists "Group admins manage settings" on public.conversation_group_settings;
create policy "Group admins insert settings" on public.conversation_group_settings for insert to authenticated
with check (app_private.can_manage_conversation(conversation_id));
create policy "Group admins update settings" on public.conversation_group_settings for update to authenticated
using (app_private.can_manage_conversation(conversation_id))
with check (app_private.can_manage_conversation(conversation_id));
create policy "Group admins delete settings" on public.conversation_group_settings for delete to authenticated
using (app_private.can_manage_conversation(conversation_id));

create index if not exists chat_list_items_conversation_user_idx on public.chat_list_items(conversation_id,user_id);
create index if not exists chat_list_items_list_user_idx on public.chat_list_items(list_id,user_id);
create index if not exists conversation_group_settings_updated_by_idx on public.conversation_group_settings(updated_by);
create index if not exists conversation_member_events_actor_idx on public.conversation_member_events(actor_id);
create index if not exists conversation_member_events_target_idx on public.conversation_member_events(target_user_id);
create index if not exists user_conversation_settings_conversation_idx on public.user_conversation_settings(conversation_id);
create index if not exists user_conversation_settings_conversation_user_idx on public.user_conversation_settings(conversation_id,user_id);
create index if not exists user_message_stars_conversation_idx on public.user_message_stars(conversation_id);
create index if not exists user_message_stars_conversation_user_idx on public.user_message_stars(conversation_id,user_id);
create index if not exists user_message_stars_message_idx on public.user_message_stars(message_id);

drop function if exists public.transfer_group_ownership(uuid,uuid);
create or replace function app_private.transfer_group_ownership_impl(p_conversation_id uuid,p_new_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_new_role text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select user_id into v_owner from public.conversation_members
    where conversation_id=p_conversation_id and role='owner' for update;
  if v_owner is distinct from v_actor then raise exception 'Only the current group owner can transfer ownership' using errcode='42501'; end if;
  select role into v_new_role from public.conversation_members
    where conversation_id=p_conversation_id and user_id=p_new_owner for update;
  if v_new_role is distinct from 'admin' then raise exception 'The new owner must already be a group administrator' using errcode='22023'; end if;
  perform set_config('app_private.owner_transfer','on',true);
  update public.conversation_members set role='admin' where conversation_id=p_conversation_id and user_id=v_actor;
  update public.conversation_members set role='owner' where conversation_id=p_conversation_id and user_id=p_new_owner;
  perform set_config('app_private.owner_transfer','off',true);
  return true;
exception when others then
  perform set_config('app_private.owner_transfer','off',true);
  raise;
end;
$$;
revoke all on function app_private.transfer_group_ownership_impl(uuid,uuid) from public, anon;
grant execute on function app_private.transfer_group_ownership_impl(uuid,uuid) to authenticated;

create or replace function public.transfer_group_ownership(p_conversation_id uuid,p_new_owner uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app_private.transfer_group_ownership_impl(p_conversation_id,p_new_owner);
$$;
revoke all on function public.transfer_group_ownership(uuid,uuid) from public, anon;
grant execute on function public.transfer_group_ownership(uuid,uuid) to authenticated;
