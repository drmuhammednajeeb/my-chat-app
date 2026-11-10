-- TEST-ONLY least-privilege overlay for a disposable local Supabase replay.
-- Never apply to a hosted project or production. This is not a production migration.
begin;

do $local_guard$
declare
begin
  if current_database() <> 'postgres'
     or current_user <> 'postgres'
     or current_setting('app.test_only_local_replay', true) <> 'enabled' then
    raise exception 'Refusing test-only privilege overlay without the guarded local runner';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
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
alter default privileges for role supabase_admin in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
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
-- Preserve INSERT on message_edit_history: edit_message_secure is SECURITY INVOKER and its RLS policy
-- permits the insert only while the function sets app.allow_message_edit = 'on'.
-- Preserve UPDATE on upsert-backed tables: PostgREST ON CONFLICT requires UPDATE privilege.
-- Trigger/RPC-owned writes continue through their reviewed SECURITY DEFINER/invoker paths.
revoke insert, update, delete on public.conversation_member_events from authenticated;
grant select on public.conversation_member_events to authenticated;

grant select on public.message_edit_history to authenticated;

revoke update, delete on public.private_reply_contexts from authenticated;
revoke delete on public.user_settings from authenticated;
revoke delete on public.conversation_group_settings from authenticated;

-- Public-schema RPCs are opt-in. Trigger functions are never client-callable.
revoke execute on all functions in schema public from public, anon;
revoke all on function public.guard_chat_message_content_update()
  from public, anon, authenticated, service_role;

-- Trigger functions are implementation details, not PostgREST RPC endpoints.
-- PostgreSQL checks EXECUTE when a trigger is created, not for each trigger firing;
-- existing triggers continue to run after these API-role grants are removed.
do $trigger_function_acl$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
      r.nspname, r.proname, r.identity_arguments
    );
  end loop;
end;
$trigger_function_acl$;


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
-- Do not query storage.buckets from this policy: private bucket rows may be hidden by
-- storage.buckets RLS, which would make the restrictive policy deny valid object writes.
-- storage.objects.bucket_id already has a foreign key to storage.buckets(id).
drop policy if exists "Require active membership for all Storage operations" on storage.objects;
create policy "Require active membership for all Storage operations"
on storage.objects as restrictive for all to authenticated
using ((select app_private.is_active_member()))
with check ((select app_private.is_active_member()));

commit;
