-- Read-only assertions after rls-least-privilege-overlay.test-only.sql.
-- Disposable local Supabase only. This file performs catalog reads only.
do $assert$
declare
  r record;
  storage_policy_issues text;
begin
  if current_database() <> 'postgres'
     or current_user <> 'postgres'
     or current_setting('app.test_only_local_replay', true) <> 'enabled' then
    raise exception 'RLS privilege assertions require the guarded local runner';
  end if;

  for r in
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relowner = 'postgres'::regrole
  loop
    if not r.relrowsecurity then
      raise exception 'RLS is disabled on public.%', r.relname;
    end if;
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = r.relname
    ) then
      raise exception 'No RLS policy exists on public.%', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'SELECT')
       or has_table_privilege('anon', r.oid, 'INSERT')
       or has_table_privilege('anon', r.oid, 'UPDATE')
       or has_table_privilege('anon', r.oid, 'DELETE')
       or has_table_privilege('anon', r.oid, 'TRUNCATE')
       or has_table_privilege('anon', r.oid, 'REFERENCES')
       or has_table_privilege('anon', r.oid, 'TRIGGER') then
      raise exception 'anon retains a table privilege on public.%', r.relname;
    end if;
    if has_table_privilege('authenticated', r.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', r.oid, 'REFERENCES')
       or has_table_privilege('authenticated', r.oid, 'TRIGGER') then
      raise exception 'authenticated retains a non-RLS table privilege on public.%', r.relname;
    end if;
    if current_setting('server_version_num')::integer >= 170000
       and has_table_privilege('authenticated', r.oid, 'MAINTAIN') then
      raise exception 'authenticated retains MAINTAIN on public.%', r.relname;
    end if;
  end loop;

  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and 'authenticated' = any(p.roles)
      and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) not ilike '%is_active_member%'
  ) then
    raise exception 'An authenticated public policy is missing the active-member guard';
  end if;

  if not has_table_privilege('authenticated','public.user_message_stars','UPDATE')
     or not has_table_privilege('authenticated','public.chat_list_items','UPDATE') then
    raise exception 'Upsert-backed user_message_stars/chat_list_items must retain UPDATE privilege';
  end if;

  if has_table_privilege('authenticated','public.conversation_member_events','INSERT')
     or has_table_privilege('authenticated','public.conversation_member_events','UPDATE')
     or has_table_privilege('authenticated','public.conversation_member_events','DELETE') then
    raise exception 'conversation_member_events must be read-only for API clients';
  end if;
  if not has_table_privilege('authenticated','public.message_edit_history','INSERT')
     or has_table_privilege('authenticated','public.message_edit_history','UPDATE')
     or has_table_privilege('authenticated','public.message_edit_history','DELETE') then
    raise exception 'message_edit_history must allow policy-gated INSERT only; UPDATE/DELETE must remain denied';
  end if;
  if has_table_privilege('authenticated','public.private_reply_contexts','UPDATE')
     or has_table_privilege('authenticated','public.private_reply_contexts','DELETE') then
    raise exception 'private_reply_contexts must not be directly mutable by clients';
  end if;
  if has_table_privilege('authenticated','public.user_settings','DELETE')
     or has_table_privilege('authenticated','public.conversation_group_settings','DELETE') then
    raise exception 'An application table has an unnecessary direct DML privilege';
  end if;

  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege('anon',c.oid,'USAGE')
        or has_sequence_privilege('anon',c.oid,'SELECT')
        or has_sequence_privilege('authenticated',c.oid,'USAGE')
        or has_sequence_privilege('authenticated',c.oid,'SELECT')
        or has_sequence_privilege('anon',c.oid,'UPDATE')
        or has_sequence_privilege('authenticated',c.oid,'UPDATE'))
  ) then
    raise exception 'anon/authenticated retain direct public sequence privileges';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon',p.oid,'EXECUTE')
        or exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ))
  ) then
    raise exception 'A public-schema function remains executable by anon or PUBLIC';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and n.nspname = 'public'
      and d.defaclobjtype in ('r','S','f')
      and a.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated')
      )
  ) then
    raise exception 'Unsafe default privileges remain for public objects';
  end if;

  -- Private application schema: helper functions may be callable by authenticated,
  -- but its tables must never be directly exposed to API roles.
  if has_schema_privilege('anon','app_private','USAGE') then
    raise exception 'anon must not have app_private schema usage';
  end if;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relkind in ('r','p')
      and (has_table_privilege('anon',c.oid,'SELECT')
        or has_table_privilege('authenticated',c.oid,'SELECT')
        or has_table_privilege('anon',c.oid,'INSERT')
        or has_table_privilege('authenticated',c.oid,'INSERT')
        or has_table_privilege('anon',c.oid,'UPDATE')
        or has_table_privilege('authenticated',c.oid,'UPDATE')
        or has_table_privilege('anon',c.oid,'DELETE')
        or has_table_privilege('authenticated',c.oid,'DELETE'))
  ) then
    raise exception 'API roles retain direct access to app_private tables';
  end if;

  -- Every SECURITY DEFINER helper must use an empty search_path and remain
  -- unavailable to PUBLIC/anon. This is separate from its body-level auth checks.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.prosecdef
      and (
        not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
        or has_function_privilege('anon',p.oid,'EXECUTE')
        or exists (
          select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'An app_private SECURITY DEFINER function has unsafe search_path or execute ACL';
  end if;

  -- Storage has its own RLS boundary and bucket-level visibility settings.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'RLS must remain enabled on storage.objects';
  end if;
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and ('anon' = any(p.roles) or 'public' = any(p.roles))
  ) then
    raise exception 'Storage object policies must not grant anon or PUBLIC access';
  end if;
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'Conversation members upload chat media'
      and p.cmd = 'INSERT'
      and lower(coalesce(p.with_check,'')) like '%storage.foldername(name)%'
      and lower(coalesce(p.with_check,'')) like '%auth.uid()%'
      and lower(coalesce(p.with_check,'')) like '%[2]%'
  ) then
    raise exception 'chat-media upload policy must bind uploader folder segment 2 to auth.uid()';
  end if;
  if exists (
    select 1 from storage.buckets
    where id in ('chat-media','conversation-documents','channel-avatars')
      and public is distinct from false
  ) then
    raise exception 'Private application Storage buckets must remain private';
  end if;
  if not exists (select 1 from storage.buckets where id='avatars' and public is true) then
    raise exception 'The explicitly public avatars bucket configuration changed; review before proceeding';
  end if;
  -- Avatar delivery is intentionally public, but all writes must remain owner-scoped.
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'Users upload own avatar' and p.cmd = 'INSERT'
      and lower(coalesce(p.with_check,'')) like '%bucket_id%'
      and lower(coalesce(p.with_check,'')) like '%avatars%'
      and lower(coalesce(p.with_check,'')) like '%storage.foldername(name)%'
      and lower(coalesce(p.with_check,'')) like '%auth.uid()%'
  ) or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'Users update own avatar' and p.cmd = 'UPDATE'
      and lower(coalesce(p.qual,'')) like '%storage.foldername(name)%'
      and lower(coalesce(p.qual,'')) like '%auth.uid()%'
      and lower(coalesce(p.with_check,'')) like '%storage.foldername(name)%'
      and lower(coalesce(p.with_check,'')) like '%auth.uid()%'
  ) or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'Users delete own avatar' and p.cmd = 'DELETE'
      and lower(coalesce(p.qual,'')) like '%storage.foldername(name)%'
      and lower(coalesce(p.qual,'')) like '%auth.uid()%'
  ) then
    raise exception 'Avatar upload/update/delete policies must remain owner-scoped';
  end if;



  if has_schema_privilege('anon','public','CREATE')
     or has_schema_privilege('authenticated','public','CREATE') then
    raise exception 'API roles must not be able to create objects in public';
  end if;
  select string_agg(
    format('%s [roles=%s; using=%s; check=%s]',
      p.policyname, p.roles, coalesce(p.qual, '<none>'), coalesce(p.with_check, '<none>')),
    E'\\n' order by p.policyname
  )
  into storage_policy_issues
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and p.policyname <> 'Require active membership for all Storage operations'
    and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) not ilike '%bucket_id%';

  if storage_policy_issues is not null then
    raise exception 'Every bucket-specific Storage object policy must be scoped to a bucket. Offending policies: %', storage_policy_issues;
  end if;

  -- Every application public table receives a RESTRICTIVE active-member policy.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relowner = 'postgres'::regrole
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.policyname = 'Require active membership for all API operations'
          and p.permissive = 'RESTRICTIVE'
          and p.cmd = 'ALL'
          and 'authenticated' = any(p.roles)
          and coalesce(p.qual,'') ilike '%is_active_member%'
          and coalesce(p.with_check,'') ilike '%is_active_member%'
      )
  ) then
    raise exception 'A public application table is missing its restrictive active-member guard';
  end if;
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Require active membership for all Storage operations'
      and p.permissive = 'RESTRICTIVE'
      and p.cmd = 'ALL'
      and 'authenticated' = any(p.roles)
      and coalesce(p.qual,'') ilike '%is_active_member%'
      and coalesce(p.with_check,'') ilike '%is_active_member%'
  ) then
    raise exception 'storage.objects is missing its restrictive active-member guard';
  end if;
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Require active membership for all Storage operations'
      and (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ilike '%storage.buckets%'
  ) then
    raise exception 'restrictive Storage guard must not query storage.buckets under bucket RLS';
  end if;

end;
$assert$;
