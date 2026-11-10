-- TEST ONLY. Run after core schema and before membership.base creates auth.users triggers.
-- Reserved .test identities and unique synthetic membership numbers; never use production data.
-- The missing-profile account is intentional and must remain without a public.profiles row.

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
(
  '22222222-2222-4222-8222-222222222201'::uuid,
  'authenticated', 'authenticated', 'direct-a@bizmindmakers.test', '',
  now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000002','membership_number_verified',true),
  jsonb_build_object('username','direct_a','display_name','Direct Test A')
),
(
  '22222222-2222-4222-8222-222222222202'::uuid,
  'authenticated', 'authenticated', 'direct-b@bizmindmakers.test', '',
  now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000003','membership_number_verified',true),
  jsonb_build_object('username','direct_b','display_name','Direct Test B')
),
(
  '22222222-2222-4222-8222-222222222203'::uuid,
  'authenticated', 'authenticated', 'direct-suspended@bizmindmakers.test', '',
  now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000004','membership_number_verified',true),
  jsonb_build_object('username','direct_suspended','display_name','Direct Test Suspended')
),
(
  '22222222-2222-4222-8222-222222222204'::uuid,
  'authenticated', 'authenticated', 'direct-unverified@bizmindmakers.test', '',
  now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000005','membership_number_verified',false),
  jsonb_build_object('username','direct_unverified','display_name','Direct Test Unverified')
),
(
  '22222222-2222-4222-8222-222222222205'::uuid,
  'authenticated', 'authenticated', 'direct-unconfirmed@bizmindmakers.test', '',
  NULL,
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000006','membership_number_verified',true),
  jsonb_build_object('username','direct_unconfirmed','display_name','Direct Test Unconfirmed')
),
(
  '22222222-2222-4222-8222-222222222206'::uuid,
  'authenticated', 'authenticated', 'direct-missing-profile@bizmindmakers.test', '',
  now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
    'membership_number','971001000007','membership_number_verified',true),
  jsonb_build_object('username','direct_missing_profile','display_name','Direct Test Missing Profile')
)
ON CONFLICT (id) DO NOTHING;

-- GoTrue password sign-in requires the matching email identity as well as auth.users.
INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider, email, created_at, updated_at
)
SELECT
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', u.email_confirmed_at IS NOT NULL),
  'email',
  u.email,
  now(),
  now()
FROM auth.users u
WHERE u.id IN (
  '22222222-2222-4222-8222-222222222201'::uuid,
  '22222222-2222-4222-8222-222222222202'::uuid,
  '22222222-2222-4222-8222-222222222203'::uuid,
  '22222222-2222-4222-8222-222222222204'::uuid,
  '22222222-2222-4222-8222-222222222205'::uuid,
  '22222222-2222-4222-8222-222222222206'::uuid
)
ON CONFLICT (provider_id, provider) DO UPDATE
SET user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    email = excluded.email,
    updated_at = now();

DO $assert$
BEGIN
  IF (SELECT count(*) FROM auth.users
      WHERE id IN (
        '22222222-2222-4222-8222-222222222201'::uuid,
        '22222222-2222-4222-8222-222222222202'::uuid,
        '22222222-2222-4222-8222-222222222203'::uuid,
        '22222222-2222-4222-8222-222222222204'::uuid,
        '22222222-2222-4222-8222-222222222205'::uuid,
        '22222222-2222-4222-8222-222222222206'::uuid
      )) <> 6 THEN
    RAISE EXCEPTION 'Synthetic direct-chat Auth seed is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = 'direct-unconfirmed@bizmindmakers.test'
      AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The unconfirmed-email fixture must remain unconfirmed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('22222222-2222-4222-8222-222222222201'::uuid, 'direct-a@bizmindmakers.test', '971001000002', true, true),
      ('22222222-2222-4222-8222-222222222202'::uuid, 'direct-b@bizmindmakers.test', '971001000003', true, true),
      ('22222222-2222-4222-8222-222222222203'::uuid, 'direct-suspended@bizmindmakers.test', '971001000004', true, true),
      ('22222222-2222-4222-8222-222222222204'::uuid, 'direct-unverified@bizmindmakers.test', '971001000005', false, true),
      ('22222222-2222-4222-8222-222222222205'::uuid, 'direct-unconfirmed@bizmindmakers.test', '971001000006', true, false),
      ('22222222-2222-4222-8222-222222222206'::uuid, 'direct-missing-profile@bizmindmakers.test', '971001000007', true, true)
    ) AS expected(id, email, membership_number, verified, confirmed)
    LEFT JOIN auth.users u ON u.id = expected.id
    WHERE u.id IS NULL
       OR u.email IS DISTINCT FROM expected.email
       OR u.raw_app_meta_data->>'membership_number' IS DISTINCT FROM expected.membership_number
       OR coalesce((u.raw_app_meta_data->>'membership_number_verified')::boolean, false)
            IS DISTINCT FROM expected.verified
       OR (u.email_confirmed_at IS NOT NULL) IS DISTINCT FROM expected.confirmed
  ) THEN
    RAISE EXCEPTION 'Synthetic Auth identities do not match the reviewed eligibility matrix';
  END IF;

  IF (SELECT count(DISTINCT raw_app_meta_data->>'membership_number')
      FROM auth.users
      WHERE id IN (
        '22222222-2222-4222-8222-222222222201'::uuid,
        '22222222-2222-4222-8222-222222222202'::uuid,
        '22222222-2222-4222-8222-222222222203'::uuid,
        '22222222-2222-4222-8222-222222222204'::uuid,
        '22222222-2222-4222-8222-222222222205'::uuid,
        '22222222-2222-4222-8222-222222222206'::uuid
      )) <> 6 THEN
    RAISE EXCEPTION 'Synthetic membership numbers must be unique';
  END IF;
END
$assert$;
