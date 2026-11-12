-- Forward reconciliation for the production public-schema privilege baseline.
-- This is a new, unapplied migration following the 62 historical production versions.
-- It removes unsafe API-role defaults and non-RLS table privileges while preserving
-- application CRUD grants and the existing service_role contract.

BEGIN;

-- Fail closed for future application objects created by the postgres migration owner.
-- Application migrations must explicitly GRANT only the privileges their client needs.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- Supabase-managed object creation must follow the same deny-by-default rule.
do $supabase_admin_defaults$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from public, anon, authenticated';
  end if;
end;
$supabase_admin_defaults$;

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

-- API clients must never create schema objects directly.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;


COMMIT;
