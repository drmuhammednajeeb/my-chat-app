-- TEST ONLY: exercise the channel-avatar read policy through authenticated PostgREST-style RLS.
-- The policy delegates authorization to app_private.can_access_channel_avatar(uuid);
-- that SECURITY DEFINER helper must enforce active membership itself.
-- All synthetic channels and Storage objects are rolled back.
BEGIN;
SELECT set_config('app.test.direct_a_id', :'direct_a_id', true);
SELECT set_config('app.test.direct_b_id', :'direct_b_id', true);
SELECT set_config('app.test.direct_suspended_id', :'direct_suspended_id', true);
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

DO $setup$
DECLARE
  v_active uuid := current_setting('app.test.direct_a_id')::uuid;
  v_other uuid := current_setting('app.test.direct_b_id')::uuid;
  v_public_channel uuid := gen_random_uuid();
  v_private_channel uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='Channel members read channel avatars'
      AND cmd='SELECT'
      AND coalesce(qual,'') ILIKE '%can_access_channel_avatar%'
  ) THEN
    RAISE EXCEPTION 'Expected channel-avatar read policy is missing or no longer delegates to the reviewed helper';
  END IF;

  IF position('is_active_member' IN pg_get_functiondef(
       'app_private.can_access_channel_avatar(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'can_access_channel_avatar must explicitly enforce active membership';
  END IF;

  INSERT INTO public.conversations(id,type,title,created_by,is_public)
  VALUES
    (v_public_channel,'channel','RLS public avatar probe',v_active,true),
    (v_private_channel,'channel','RLS private avatar probe',v_active,false);

  INSERT INTO public.conversation_members(conversation_id,user_id,role)
  VALUES (v_private_channel,v_active,'owner');

  INSERT INTO storage.objects(bucket_id,name,owner_id)
  VALUES
    ('channel-avatars',v_public_channel::text||'/'||v_active::text||'/public.png',v_active::text),
    ('channel-avatars',v_private_channel::text||'/'||v_active::text||'/private.png',v_active::text);

  PERFORM set_config('app.test.public_channel_id',v_public_channel::text,true);
  PERFORM set_config('app.test.private_channel_id',v_private_channel::text,true);
  PERFORM set_config('app.test.active_user_id',v_active::text,true);
  PERFORM set_config('app.test.other_user_id',v_other::text,true);
END
$setup$;

SET LOCAL ROLE authenticated;

-- An active non-member may read a public channel avatar.
SELECT set_config('request.jwt.claim.sub',current_setting('app.test.other_user_id'),true);
DO $public_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='channel-avatars'
      AND name=current_setting('app.test.public_channel_id')||'/'||
        current_setting('app.test.active_user_id')||'/public.png'
  ) THEN
    RAISE EXCEPTION 'Active member could not read a public channel avatar';
  END IF;
END
$public_read$;

-- The same active non-member must not read a private channel avatar.
DO $private_denial$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='channel-avatars'
      AND name=current_setting('app.test.private_channel_id')||'/'||
        current_setting('app.test.active_user_id')||'/private.png'
  ) THEN
    RAISE EXCEPTION 'Non-member read a private channel avatar';
  END IF;
END
$private_denial$;

-- A channel member may read the private channel avatar.
SELECT set_config('request.jwt.claim.sub',current_setting('app.test.active_user_id'),true);
DO $member_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='channel-avatars'
      AND name=current_setting('app.test.private_channel_id')||'/'||
        current_setting('app.test.active_user_id')||'/private.png'
  ) THEN
    RAISE EXCEPTION 'Active channel member could not read the private channel avatar';
  END IF;
END
$member_read$;

-- A suspended account must be denied even for a public channel avatar.
SELECT set_config('request.jwt.claim.sub',:'direct_suspended_id',true);
DO $suspended_denial$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='channel-avatars'
      AND name=current_setting('app.test.public_channel_id')||'/'||
        current_setting('app.test.active_user_id')||'/public.png'
  ) THEN
    RAISE EXCEPTION 'Suspended account read a public channel avatar';
  END IF;
END
$suspended_denial$;

RESET ROLE;
ROLLBACK;
