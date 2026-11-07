
create or replace function app_private.guard_group_member_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transfer boolean := coalesce(current_setting('app_private.owner_transfer', true),'off')='on';
begin
  if old.role is distinct from new.role then
    if not app_private.can_manage_conversation(old.conversation_id) then
      raise exception 'Only group administrators can change member roles' using errcode='42501';
    end if;
    if old.role='owner' and not (v_transfer and auth.uid()=old.user_id) and not app_private.is_team_admin() then
      raise exception 'The group owner role can only be transferred by its owner' using errcode='42501';
    end if;
    if new.role='owner' and not v_transfer and not app_private.is_team_admin() then
      raise exception 'Only an authorized ownership transfer can assign ownership' using errcode='42501';
    end if;
  end if;
  if old.user_id is distinct from new.user_id or old.conversation_id is distinct from new.conversation_id then
    raise exception 'Membership identity cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function public.transfer_group_ownership(p_conversation_id uuid,p_new_owner uuid)
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
revoke all on function public.transfer_group_ownership(uuid,uuid) from public, anon;
grant execute on function public.transfer_group_ownership(uuid,uuid) to authenticated;
