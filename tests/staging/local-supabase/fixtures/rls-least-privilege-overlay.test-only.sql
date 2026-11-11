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

-- PostgreSQL's global function default grants EXECUTE to PUBLIC; a schema-scoped
-- REVOKE cannot remove that global default. Disable it for postgres-created functions.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema app_private
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

-- Remove PUBLIC/anon execution from all public functions. Authenticated execution is checked against the reviewed RPC allowlist in the assertion file.
revoke execute on all functions in schema public from public, anon;
revoke all on function public.guard_chat_message_content_update()
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_create_member_invites(text[])
  from public, anon, authenticated;

-- Private trigger functions are not API RPCs; RLS helpers and RPC implementations
-- retain their separately reviewed authenticated grants.
revoke execute on function app_private.guard_conversation_member_update()
  from public, anon, authenticated;
revoke execute on function app_private.enforce_chat_message_reply_parent()
  from public, anon, authenticated;


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
