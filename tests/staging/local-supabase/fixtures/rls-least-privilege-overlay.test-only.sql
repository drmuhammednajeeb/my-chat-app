-- TEST-ONLY least-privilege overlay for a disposable local Supabase replay.
-- Never apply to a hosted project or production. This is not a production migration.
begin;

do $local_guard$
declare
  v_addr inet := inet_server_addr();
begin
  if current_database() <> 'postgres'
     or current_user <> 'postgres'
     or v_addr is null
     or not (v_addr <<= '127.0.0.0/8'::cidr or v_addr = '::1'::inet) then
    raise exception 'Refusing test-only privilege overlay outside loopback postgres@postgres';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Supabase API roles are missing';
  end if;
end;
$local_guard$;

-- Fail closed for future application objects created by the postgres migration owner.
-- Application migrations must explicitly GRANT only the privileges their client needs.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- Remove API access from anon at the table/sequence layer. RLS remains an independent
-- mandatory boundary; this also prevents non-RLS privileges such as TRUNCATE.
revoke all privileges on all tables in schema public from public, anon;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- Authenticated clients never need schema-changing table privileges.
revoke truncate, references, trigger on all tables in schema public from authenticated;

do $maintain_guard$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on all tables in schema public from authenticated';
  end if;
end;
$maintain_guard$;

-- Remove direct write paths that are not part of the supported client contract.
-- Trigger/RPC-owned writes continue through their reviewed SECURITY DEFINER/invoker paths.
revoke insert, update, delete on public.conversation_member_events from authenticated;
grant select on public.conversation_member_events to authenticated;

revoke insert on public.message_edit_history from authenticated;
grant select on public.message_edit_history to authenticated;

revoke update, delete on public.private_reply_contexts from authenticated;
revoke update on public.user_message_stars from authenticated;
revoke delete on public.user_settings from authenticated;
revoke update on public.chat_list_items from authenticated;
revoke delete on public.conversation_group_settings from authenticated;

-- Public-schema RPCs are opt-in. Trigger functions are never client-callable.
revoke execute on all functions in schema public from public, anon;
revoke all on function public.guard_chat_message_content_update()
  from public, anon, authenticated, service_role;


-- Add a restrictive membership gate in addition to each table's feature-specific
-- permissive policy. PostgreSQL combines permissive policies with OR, so this
-- restrictive guard prevents a later permissive policy from bypassing active status.
do $public_restrictive_guard$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relowner = 'postgres'::regrole
      and c.relrowsecurity
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Require active membership for all API operations',
      r.relname
    );
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()))',
      'Require active membership for all API operations',
      r.relname
    );
  end loop;
end;
$public_restrictive_guard$;

-- Apply the same non-bypassable active-member boundary to Storage API operations.
drop policy if exists "Require active membership for all Storage operations" on storage.objects;
create policy "Require active membership for all Storage operations"
on storage.objects as restrictive for all to authenticated
using ((select app_private.is_active_member()))
with check ((select app_private.is_active_member()));

commit;
