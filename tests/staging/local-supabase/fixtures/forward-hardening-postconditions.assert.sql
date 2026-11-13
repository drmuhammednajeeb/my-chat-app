-- Verify the forward conversation-image migration uses a literal-dot suffix check.
DO $conversation_image_extension$
DECLARE
  v_trigger_definition text;
  v_rpc_definition text;
BEGIN
  IF NOT ('sample.jpg' ~ '\.(jpg|png|webp)$')
     OR NOT ('sample.PNG' ~* '\.(jpg|png|webp)$')
     OR NOT ('sample.webp' ~* '\.(jpg|png|webp)$')
     OR ('sample.txt' ~* '\.(jpg|png|webp)$') THEN
    RAISE EXCEPTION 'Conversation image extension regex behavior is incorrect';
  END IF;

  v_trigger_definition := pg_get_functiondef(
    'app_private.validate_conversation_image_path()'::regprocedure
  );
  v_rpc_definition := pg_get_functiondef(
    'public.set_conversation_image(uuid,text)'::regprocedure
  );

  IF position($needle$!~* '\.(jpg|png|webp)$'$needle$ IN v_trigger_definition) = 0
     OR position($needle$!~* '\.(jpg|png|webp)$'$needle$ IN v_rpc_definition) = 0 THEN
    RAISE EXCEPTION 'A conversation image function does not contain the corrected literal-dot suffix check';
  END IF;
END;
$conversation_image_extension$;

-- TEST ONLY: post-forward-migration privilege, RLS, and CRUD compatibility assertions.
-- Run after 20261112160002, 20261112160003, and 202611130002 in disposable local Supabase.
-- Catalog assertions are read-only; CRUD assertions run inside a transaction ending in ROLLBACK.

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


-- TEST ONLY: rollback-only CRUD/RPC compatibility after forward privilege and active-membership migrations.
-- Requires the synthetic active direct-chat identities and the completed forward migrations.
-- All inserted rows and the direct conversation are rolled back.
BEGIN;
SELECT set_config('app.test.direct_a_id', :'direct_a_id', true);
SELECT set_config('app.test.direct_b_id', :'direct_b_id', true);
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('app.test.direct_a_id'),true);

DO $crud_compatibility$
DECLARE
  v_user_a uuid := current_setting('app.test.direct_a_id')::uuid;
  v_user_b uuid := current_setting('app.test.direct_b_id')::uuid;
  v_conversation uuid;
  v_message uuid;
  v_list uuid;
  v_count integer;
  v_rejected boolean;
BEGIN
  -- Real RPC path: create/reuse a direct conversation for two eligible synthetic users.
  v_conversation := public.get_or_create_direct_conversation(v_user_b);
  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'Direct conversation RPC returned NULL';
  END IF;

  -- Real message INSERT path, including SECURITY DEFINER triggers.
  INSERT INTO public.chat_messages(conversation_id,sender_id,content)
  VALUES(v_conversation,v_user_a,'RLS runtime CRUD probe')
  RETURNING id INTO v_message;

  -- Chat list create/read/update/delete path.
  INSERT INTO public.chat_lists(user_id,name)
  VALUES(v_user_a,'RLS Runtime Probe')
  RETURNING id INTO v_list;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_lists WHERE id=v_list AND user_id=v_user_a
  ) THEN
    RAISE EXCEPTION 'Owner cannot read own chat list after overlay';
  END IF;

  UPDATE public.chat_lists SET name='RLS Runtime Probe Updated'
  WHERE id=v_list AND user_id=v_user_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot update own chat list after overlay';
  END IF;

  -- The UI uses ON CONFLICT upsert for chat_list_items; UPDATE privilege is required.
  INSERT INTO public.chat_list_items(user_id,list_id,conversation_id)
  VALUES(v_user_a,v_list,v_conversation)
  ON CONFLICT(user_id,list_id,conversation_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;
  INSERT INTO public.chat_list_items(user_id,list_id,conversation_id)
  VALUES(v_user_a,v_list,v_conversation)
  ON CONFLICT(user_id,list_id,conversation_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;

  -- The UI uses ON CONFLICT upsert for user_message_stars; UPDATE must remain granted.
  INSERT INTO public.user_message_stars(user_id,conversation_id,message_id)
  VALUES(v_user_a,v_conversation,v_message)
  ON CONFLICT(user_id,message_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;
  INSERT INTO public.user_message_stars(user_id,conversation_id,message_id)
  VALUES(v_user_a,v_conversation,v_message)
  ON CONFLICT(user_id,message_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;

  -- The invoker RPC must still append its policy-gated audit row and update the message.
  PERFORM public.edit_message_secure(v_message,'RLS runtime CRUD probe edited',0);
  IF NOT EXISTS (
    SELECT 1 FROM public.message_edit_history
    WHERE message_id=v_message AND editor_id=v_user_a AND revision_number=1
  ) THEN
    RAISE EXCEPTION 'edit_message_secure did not persist its audit row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE id=v_message AND content='RLS runtime CRUD probe edited' AND edit_revision=1
  ) THEN
    RAISE EXCEPTION 'edit_message_secure did not update the message';
  END IF;

  -- The same audit table must reject direct INSERT without the secure-edit guard.
  v_rejected := false;
  BEGIN
    INSERT INTO public.message_edit_history(
      message_id,editor_id,old_content,new_content,revision_number,edited_at
    ) VALUES(
      v_message,v_user_a,'forged old','forged new',99,now()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Direct message_edit_history INSERT bypassed the secure-edit guard';
  END IF;

  -- A second active member must not read or mutate the first user's private chat list.
  PERFORM set_config('request.jwt.claim.sub',v_user_b::text,true);
  IF EXISTS (SELECT 1 FROM public.chat_lists WHERE id=v_list) THEN
    RAISE EXCEPTION 'Cross-user chat list read was not isolated';
  END IF;
  UPDATE public.chat_lists SET name='cross-user mutation' WHERE id=v_list;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cross-user chat list update was not isolated';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.chat_lists(user_id,name)
    VALUES(v_user_a,'cross-user insert attempt');
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-user chat list INSERT was accepted';
  END IF;

  -- A conversation member may read the message, but not another author's edit history.
  IF EXISTS (
    SELECT 1 FROM public.message_edit_history WHERE message_id=v_message
  ) THEN
    RAISE EXCEPTION 'Non-author can read another member edit history';
  END IF;

  -- Return to the owner and verify normal DELETE paths still work.
  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,true);
  DELETE FROM public.chat_list_items
  WHERE user_id=v_user_a AND list_id=v_list AND conversation_id=v_conversation;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot delete own chat list item after overlay';
  END IF;

  DELETE FROM public.user_message_stars
  WHERE user_id=v_user_a AND message_id=v_message;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot remove own starred message after overlay';
  END IF;

  DELETE FROM public.chat_lists WHERE id=v_list;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot delete own chat list after overlay';
  END IF;
END
$crud_compatibility$;

RESET ROLE;
ROLLBACK;
