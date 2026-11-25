-- Assertions for the post-table extensions: FK-leading indexes and caller-RLS preview RPC.
do $assert_visibility_extensions$
begin
  if to_regclass('public.user_hidden_messages_conversation_id_idx') is null
     or to_regclass('public.user_hidden_messages_message_id_idx') is null
     or to_regclass('public.user_conversation_pins_conversation_id_idx') is null then
    raise exception 'per-user visibility and pin foreign-key indexes are missing';
  end if;

  if to_regprocedure('public.get_latest_visible_conversation_messages(uuid[])') is null then
    raise exception 'RLS-safe visible conversation preview RPC is missing';
  end if;
  if has_function_privilege('anon','public.get_latest_visible_conversation_messages(uuid[])','EXECUTE')
     or not has_function_privilege('authenticated','public.get_latest_visible_conversation_messages(uuid[])','EXECUTE') then
    raise exception 'visible conversation preview RPC execute ACL is not least-privilege';
  end if;
  if (select prosecdef from pg_proc where oid='public.get_latest_visible_conversation_messages(uuid[])'::regprocedure) then
    raise exception 'visible conversation preview RPC must remain SECURITY INVOKER';
  end if;
end;
$assert_visibility_extensions$;
