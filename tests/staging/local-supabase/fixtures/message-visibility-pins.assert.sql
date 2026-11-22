-- Test-only post-migration assertions for per-user message visibility, conversation pins and secure deletion.
do $assert$
declare
  v_hidden_rls boolean;
  v_pins_rls boolean;
  v_delete_oid oid;
  v_delete_proconfig text[];
  v_delete_security_definer boolean;
  v_delete_definition text;
  v_edit_definition text;
  v_hidden_insert_check text;
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

  select with_check into v_hidden_insert_check
  from pg_policies
  where schemaname = 'public' and tablename = 'user_hidden_messages'
    and policyname = 'Users hide messages for themselves';
  if v_hidden_insert_check is null
     or position('clock_timestamp()' in lower(v_hidden_insert_check)) = 0
     or position('created_at' in lower(v_hidden_insert_check)) = 0
     or position('deleted_at' in lower(v_hidden_insert_check)) = 0 then
    raise exception 'delete-for-me policy must enforce the database-clock 15-minute window and reject deleted messages';
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
  v_delete_definition := pg_get_functiondef(v_delete_oid);
  if position('interval ''15 minutes''' in v_delete_definition) = 0
     or position('v_message.sender_id <> v_user_id' in v_delete_definition) = 0
     or position('app_private.is_conversation_member' in v_delete_definition) = 0
     or position('app.allow_message_delete' in v_delete_definition) = 0 then
    raise exception 'secure delete must enforce the original 15-minute deadline, author, active membership, and trigger guard';
  end if;

  select pg_get_functiondef(p.oid) into v_edit_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'edit_message_secure'
    and pg_get_function_identity_arguments(p.oid) = 'p_message_id uuid, p_new_content text, p_expected_revision integer';
  if v_edit_definition is null
     or position('interval ''15 minutes''' in v_edit_definition) = 0
     or position('p_expected_revision' in v_edit_definition) = 0 then
    raise exception 'secure edit must retain the original 15-minute deadline and revision guard';
  end if;
  if v_delete_security_definer is distinct from true then
    raise exception 'delete_message_secure must remain SECURITY DEFINER';
  end if;
  if not coalesce(v_delete_proconfig @> array['search_path=""'], false) then
    raise exception 'delete_message_secure must have an empty search_path';
  end if;
  if has_function_privilege('anon', v_delete_oid, 'EXECUTE')
     or exists (
       select 1
       from aclexplode(coalesce((select p.proacl from pg_proc p where p.oid = v_delete_oid),
                                acldefault('f', (select p.proowner from pg_proc p where p.oid = v_delete_oid)))) acl
       where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) then
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
