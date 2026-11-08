-- Align all official Forever membership number validation to 971 + nine digits (12 digits total).
-- This preserves existing membership values, unique indexes, RLS, and authorization boundaries.

DO $migration$
DECLARE
  r record;
  v_definition text;
  v_replacements integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.prokind = 'f'
      AND p.proname IN (
        'admin_create_official_member_invites_impl',
        'admin_set_member_official_number_impl',
        'create_profile_for_invited_user',
        'enforce_invited_auth_signup',
        'guard_profile_membership_fields',
        'is_active_member'
      )
  LOOP
    v_definition := pg_get_functiondef(r.oid);
    IF position('^971001[0-9]{6}$' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Expected legacy membership validation not found in function OID %', r.oid;
    END IF;
    v_definition := replace(v_definition, '^971001[0-9]{6}$', '^971[0-9]{9}$');
    v_definition := replace(v_definition, '971001XXXXXX', '971XXXXXXXXX');
    v_definition := replace(v_definition, 'يبدأ بـ 971001 ويتبعه ستة أرقام', 'يبدأ بـ 971 ويتبعه تسعة أرقام');
    v_definition := replace(v_definition, 'يجب أن يبدأ بـ 971001 ويتبعه ستة أرقام', 'يجب أن يبدأ بـ 971 ويتبعه تسعة أرقام');
    v_definition := replace(v_definition, '971001 ثم ستة أرقام', '971 ثم تسعة أرقام');
    EXECUTE v_definition;
    v_replacements := v_replacements + 1;
  END LOOP;

  IF v_replacements <> 6 THEN
    RAISE EXCEPTION 'Expected to update 6 membership functions; updated %', v_replacements;
  END IF;
END
$migration$;

ALTER TABLE app_private.member_invitations
  DROP CONSTRAINT member_invitation_number_format;
ALTER TABLE app_private.member_invitations
  ADD CONSTRAINT member_invitation_number_format
  CHECK (membership_number ~ '^971[0-9]{9}$');

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_membership_number_official_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_membership_number_official_format
  CHECK (membership_number IS NULL OR membership_number ~ '^971[0-9]{9}$');
