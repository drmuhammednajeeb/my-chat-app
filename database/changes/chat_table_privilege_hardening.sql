-- Harden chat table privileges and prevent self-promotion.
begin;

-- RLS does not apply to TRUNCATE; remove broad table grants.
revoke all privileges on table public.message_pins, public.message_reactions
from public, anon, authenticated;

grant select, insert, delete on table public.message_pins to authenticated;
grant select, insert, update(reaction_type), delete on table public.message_reactions to authenticated;

-- Only read receipts and the role field are eligible for membership updates.
revoke update on table public.conversation_members from public, anon, authenticated;
revoke update (conversation_id, user_id, role, joined_at, last_read_at, last_delivered_at)
on table public.conversation_members from public, anon, authenticated;
grant update (last_read_at, last_delivered_at, role)
on table public.conversation_members to authenticated;

create or replace function app_private.guard_conversation_member_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.conversation_id is distinct from old.conversation_id
       or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at then
      raise exception 'Membership identity fields cannot be changed'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role
       and not app_private.is_team_admin() then
      raise exception 'Only a team administrator can change membership roles'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_conversation_member_update on public.conversation_members;
create trigger guard_conversation_member_update
before update on public.conversation_members
for each row execute function app_private.guard_conversation_member_update();

-- Allow only the message fields used by edit and soft-delete.
revoke update on table public.chat_messages from public, anon, authenticated;
revoke update (id, conversation_id, sender_id, content, attachment_path, attachment_type,
               reply_to, edited_at, deleted_at, created_at)
on table public.chat_messages from public, anon, authenticated;
grant update (content, attachment_path, attachment_type, edited_at, deleted_at)
on table public.chat_messages to authenticated;

-- The client does not edit conversation metadata directly.
revoke update on table public.conversations from public, anon, authenticated;

-- Trigger functions are not application RPC endpoints.
revoke all on function app_private.enforce_group_member_limit() from public, anon, authenticated;

-- Remove public from the SECURITY DEFINER function's search path.
alter function app_private.get_or_create_direct_conversation_impl(uuid)
set search_path = '';

commit;