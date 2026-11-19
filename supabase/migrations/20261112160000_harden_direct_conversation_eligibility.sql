-- Forward reconciliation: require both direct-conversation participants to be eligible.
-- The original 62-version production ledger is preserved; this is a new post-ledger hardening migration.
-- Eligibility is checked from authoritative profile/Auth rows and locked through the transaction.

BEGIN;

-- Preserves the original advisory-lock serialization and duplicate-reuse behavior.
-- The public invoker wrapper and function ACL remain unchanged.

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
  v_eligible_count integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'A different user must be selected' using errcode = '22023';
  end if;

  -- Reuse the existing canonical membership predicate for the caller.
  -- It checks active status, verified membership number, valid number format,
  -- and confirmed email against auth.users (not user-editable JWT metadata).
  if not app_private.is_active_member() then
    raise exception 'Both participants must meet direct-conversation eligibility requirements'
      using errcode = '42501';
  end if;

  -- Validate and lock both participants' authoritative rows in stable UUID order.
  -- Locks prevent membership/email eligibility from changing before this transaction
  -- finishes creating or reusing the direct conversation.
  PERFORM p.id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id IN (v_user_id, p_other_user_id)
    AND p.membership_status = 'active'
    AND p.membership_number_verified IS TRUE
    AND p.membership_number ~ '^971[0-9]{9}$'
    AND u.email_confirmed_at IS NOT NULL
  ORDER BY p.id
  FOR SHARE OF p, u;

  GET DIAGNOSTICS v_eligible_count = ROW_COUNT;

  if v_eligible_count <> 2 then
    raise exception 'Both participants must meet direct-conversation eligibility requirements'
      using errcode = '42501';
  end if;

  v_pair_key := least(v_user_id::text, p_other_user_id::text) || ':' ||
                greatest(v_user_id::text, p_other_user_id::text);

  -- Preserve the original per-pair serialization and duplicate-reuse behavior.
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

-- Reassert the internal-function ACL for authenticated and service_role only.
REVOKE ALL ON FUNCTION app_private.get_or_create_direct_conversation_impl(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_or_create_direct_conversation_impl(uuid)
  TO authenticated, service_role;


COMMIT;
