-- RECOVERED SOURCE: final direct-conversation RPC definitions from the production catalog.
-- Extracted read-only with pg_proc / pg_get_functiondef; function bodies and inspected ACLs are preserved.
-- The original two migration bodies were not retained in the repository. This clean-bootstrap reconstruction
-- places the final implementation in the first production version; the following historical version is a no-op.
-- This reconstruction is not a claim of byte-for-byte equivalence with the original migrations.
-- Production already records both versions. Never reapply either migration to production.

BEGIN;

CREATE OR REPLACE FUNCTION app_private.get_or_create_direct_conversation_impl(p_other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_pair_key text;
  v_conversation_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'A different user must be selected' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  v_pair_key := least(v_user_id::text, p_other_user_id::text) || ':' ||
                greatest(v_user_id::text, p_other_user_id::text);

  -- Serialize creation for this user pair across devices and concurrent sessions.
  perform pg_advisory_xact_lock(hashtextextended(v_pair_key, 0));

  select c.id
    into v_conversation_id
  from public.conversations c
  where c.type = 'direct'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = c.id and cm.user_id = v_user_id
    )
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = c.id and cm.user_id = p_other_user_id
    )
    and (
      select count(*) from public.conversation_members cm
      where cm.conversation_id = c.id
    ) = 2
  order by c.created_at asc
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations (type, title, created_by)
    values ('direct', null, v_user_id)
    returning id into v_conversation_id;

    insert into public.conversation_members (conversation_id, user_id, role)
    values
      (v_conversation_id, v_user_id, 'owner'),
      (v_conversation_id, p_other_user_id, 'member');
  end if;

  return v_conversation_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_other_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select app_private.get_or_create_direct_conversation_impl(p_other_user_id);
$function$;

REVOKE ALL ON FUNCTION app_private.get_or_create_direct_conversation_impl(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_or_create_direct_conversation_impl(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid)
  TO authenticated, service_role;

COMMIT;
