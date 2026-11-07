-- Atomically create (or retrieve) the signed-in user's personal chat.
create or replace function public.ensure_self_chat()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  insert into public.conversations (type, title, description, created_by)
  values ('group', 'ملاحظاتي', 'bizmindmakers:self-chat:v1', (select auth.uid()))
  on conflict (created_by)
    where type = 'group' and description = 'bizmindmakers:self-chat:v1'
  do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select id into v_conversation_id
    from public.conversations
    where created_by = (select auth.uid())
      and type = 'group'
      and description = 'bizmindmakers:self-chat:v1';
  end if;

  if v_conversation_id is null then
    raise exception 'Could not initialize personal chat';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conversation_id, (select auth.uid()), 'owner')
  on conflict (conversation_id, user_id) do nothing;

  return v_conversation_id;
end;
$$;

revoke all on function public.ensure_self_chat() from public;
revoke all on function public.ensure_self_chat() from anon;
grant execute on function public.ensure_self_chat() to authenticated;
