-- Reconstructed from the live production catalog on 2026-11-12.
-- Production version: 20261107160733 / harden_channel_rpc_wrappers.
-- The original SQL body was not present in Git history or supplied project records.
-- Public RPCs are invoker wrappers; privileged work remains in app_private SECURITY DEFINER functions.
-- Do not apply to production: this version is already present in the production ledger.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_channel(p_title text, p_description text DEFAULT ''::text, p_is_public boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select app_private.create_channel(p_title,p_description,p_is_public);
$function$;
REVOKE ALL ON FUNCTION public.create_channel(p_title text, p_description text, p_is_public boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_channel(p_title text, p_description text, p_is_public boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.discover_public_channels(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, description text, avatar_path text, member_count bigint, is_member boolean, created_at timestamp with time zone, is_public boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from app_private.discover_public_channels(p_search,p_limit,p_offset);
$function$;
REVOKE ALL ON FUNCTION public.discover_public_channels(p_search text, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_public_channels(p_search text, p_limit integer, p_offset integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.join_public_channel(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select app_private.join_public_channel(p_conversation_id);
$function$;
REVOKE ALL ON FUNCTION public.join_public_channel(p_conversation_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_public_channel(p_conversation_id uuid) TO authenticated, service_role;

COMMIT;
