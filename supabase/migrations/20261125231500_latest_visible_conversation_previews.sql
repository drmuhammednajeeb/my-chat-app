-- Return the latest non-hidden message for each requested conversation.
-- SECURITY INVOKER preserves chat_messages and user_hidden_messages RLS for the caller.

create or replace function public.get_latest_visible_conversation_messages(p_conversation_ids uuid[])
returns table (
  id uuid,
  conversation_id uuid,
  content text,
  created_at timestamptz,
  sender_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select distinct on (m.conversation_id)
    m.id,
    m.conversation_id,
    m.content,
    m.created_at,
    m.sender_id
  from public.chat_messages as m
  where m.conversation_id = any(coalesce(p_conversation_ids, array[]::uuid[]))
    and m.deleted_at is null
    and not exists (
      select 1
      from public.user_hidden_messages as h
      where h.user_id = (select auth.uid())
        and h.message_id = m.id
    )
  order by m.conversation_id, m.created_at desc, m.id desc;
$function$;

revoke all on function public.get_latest_visible_conversation_messages(uuid[]) from public, anon, service_role;
grant execute on function public.get_latest_visible_conversation_messages(uuid[]) to authenticated;

comment on function public.get_latest_visible_conversation_messages(uuid[]) is
  'Returns the latest non-deleted, non-hidden message per conversation under the caller RLS context. SECURITY INVOKER; no cross-user visibility override.';
