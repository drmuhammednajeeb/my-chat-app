-- Test-only post-migration assertions for per-user message visibility, conversation pins and secure deletion.
do $assert$
declare
  v_hidden_rls boolean;
  v_pins_rls boolean;
  v_delete_oid oid;
  v_delete_proconfig text[];
  v_delete_security_definer boolean;
begin
  select c.relrowsecurity into v_hidden_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'user_hidden_messages';
  if v_hidden_rls is distinct from true then
    raise exception 'user_hidden_messages must have RLS enabled';
  end if;

  select c.relrowsecurity into v_pins_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'user_conversation_pins';
  if v_pins_rls is distinct from true then
    raise exception 'user_conversation_pins must have RLS enabled';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_hidden_messages'
      and policyname = 'Users hide messages for themselves'
      and cmd = 'INSERT'
  ) then
    raise exception 'per-user hidden-message INSERT policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_conversation_pins'
      and policyname = 'Users pin conversations they belong to'
      and cmd = 'INSERT'
  ) then
    raise exception 'per-user conversation-pin INSERT policy is missing';
  end if;

  select p.oid, p.proconfig, p.prosecdef
  into v_delete_oid, v_delete_proconfig, v_delete_security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'delete_message_secure'
    and pg_get_function_identity_arguments(p.oid) = 'p_message_id uuid';

  if v_delete_oid is null then
    raise exception 'public.delete_message_secure(uuid) is missing';
  end if;
  if v_delete_security_definer is distinct from false then
    raise exception 'delete_message_secure must remain SECURITY INVOKER';
  end if;
  if not coalesce(v_delete_proconfig @> array['search_path=""'], false) then
    raise exception 'delete_message_secure must have an empty search_path';
  end if;
  if has_function_privilege('anon', v_delete_oid, 'EXECUTE')
     or has_function_privilege('public', v_delete_oid, 'EXECUTE') then
    raise exception 'delete_message_secure must not be executable by anon or PUBLIC';
  end if;
  if not has_function_privilege('authenticated', v_delete_oid, 'EXECUTE') then
    raise exception 'authenticated must be able to execute delete_message_secure';
  end if;

  if has_table_privilege('anon', 'public.user_hidden_messages', 'SELECT')
     or has_table_privilege('anon', 'public.user_conversation_pins', 'SELECT') then
    raise exception 'anonymous table reads must remain revoked';
  end if;
end;
$assert$;
