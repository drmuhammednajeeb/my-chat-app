-- TEST ONLY. GoTrue Admin API creates these reserved .test users before membership.base.
-- This fixture validates Auth-owned rows; it never inserts into auth.users or auth.identities.
-- The missing-profile account is intentional and must remain without a public.profiles row.

DO $assert$
DECLARE
  expected record;
BEGIN
  IF (SELECT count(*) FROM auth.users
      WHERE email IN (
        'direct-a@bizmindmakers.test',
        'direct-b@bizmindmakers.test',
        'direct-c@bizmindmakers.test',
        'direct-suspended@bizmindmakers.test',
        'direct-unverified@bizmindmakers.test',
        'direct-unconfirmed@bizmindmakers.test',
        'direct-missing-profile@bizmindmakers.test'
      )) <> 7 THEN
    RAISE EXCEPTION 'Synthetic direct-chat Auth seed is incomplete';
  END IF;

  IF (SELECT count(*)
      FROM auth.identities i
      JOIN auth.users u ON u.id = i.user_id
      WHERE u.email IN (
        'direct-a@bizmindmakers.test',
        'direct-b@bizmindmakers.test',
        'direct-c@bizmindmakers.test',
        'direct-suspended@bizmindmakers.test',
        'direct-unverified@bizmindmakers.test',
        'direct-unconfirmed@bizmindmakers.test',
        'direct-missing-profile@bizmindmakers.test'
      ) AND i.provider = 'email') <> 7 THEN
    RAISE EXCEPTION 'GoTrue did not create all seven email identities';
  END IF;

  FOR expected IN
    SELECT * FROM (VALUES
      ('direct-a@bizmindmakers.test', '971001000002', true, true),
      ('direct-b@bizmindmakers.test', '971001000003', true, true),
      ('direct-c@bizmindmakers.test', '971001000008', true, true),
      ('direct-suspended@bizmindmakers.test', '971001000004', true, true),
      ('direct-unverified@bizmindmakers.test', '971001000005', false, true),
      ('direct-unconfirmed@bizmindmakers.test', '971001000006', true, false),
      ('direct-missing-profile@bizmindmakers.test', '971001000007', true, true)
    ) AS rows(email, membership_number, verified, confirmed)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.email = expected.email
        AND u.raw_app_meta_data->>'membership_number' = expected.membership_number
        AND coalesce((u.raw_app_meta_data->>'membership_number_verified')::boolean, false)
              IS NOT DISTINCT FROM expected.verified
        AND (u.email_confirmed_at IS NOT NULL) IS NOT DISTINCT FROM expected.confirmed
    ) THEN
      RAISE EXCEPTION 'Synthetic Auth identity does not match the reviewed eligibility matrix: %', expected.email;
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT raw_app_meta_data->>'membership_number')
      FROM auth.users
      WHERE email IN (
        'direct-a@bizmindmakers.test',
        'direct-b@bizmindmakers.test',
        'direct-c@bizmindmakers.test',
        'direct-suspended@bizmindmakers.test',
        'direct-unverified@bizmindmakers.test',
        'direct-unconfirmed@bizmindmakers.test',
        'direct-missing-profile@bizmindmakers.test'
      )) <> 7 THEN
    RAISE EXCEPTION 'Synthetic membership numbers must be unique';
  END IF;
END
$assert$;
