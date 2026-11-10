-- TEST ONLY. Run after membership.base installs the profile guard and before membership.official.
-- Auth users are provisioned through GoTrue; this fixture creates profiles only.
-- The missing-profile Auth identity is deliberately omitted.

INSERT INTO public.profiles (id, username, display_name)
SELECT u.id, expected.username, expected.display_name
FROM (VALUES
  ('direct-a@bizmindmakers.test', 'direct_a', 'Direct Test A'),
  ('direct-b@bizmindmakers.test', 'direct_b', 'Direct Test B'),
  ('direct-suspended@bizmindmakers.test', 'direct_suspended', 'Direct Test Suspended'),
  ('direct-unverified@bizmindmakers.test', 'direct_unverified', 'Direct Test Unverified'),
  ('direct-unconfirmed@bizmindmakers.test', 'direct_unconfirmed', 'Direct Test Unconfirmed')
) AS expected(email, username, display_name)
JOIN auth.users u ON u.email = expected.email
ON CONFLICT (id) DO NOTHING;

DO $assert$
BEGIN
  IF (SELECT count(*)
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
      WHERE u.email IN (
        'direct-a@bizmindmakers.test',
        'direct-b@bizmindmakers.test',
        'direct-suspended@bizmindmakers.test',
        'direct-unverified@bizmindmakers.test',
        'direct-unconfirmed@bizmindmakers.test'
      )) <> 5 THEN
    RAISE EXCEPTION 'Synthetic direct-chat profile seed is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE u.email = 'direct-missing-profile@bizmindmakers.test'
  ) THEN
    RAISE EXCEPTION 'Missing-profile test identity unexpectedly has a profile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE u.email IN (
      'direct-a@bizmindmakers.test',
      'direct-b@bizmindmakers.test',
      'direct-suspended@bizmindmakers.test',
      'direct-unverified@bizmindmakers.test',
      'direct-unconfirmed@bizmindmakers.test'
    )
      AND (p.membership_number IS DISTINCT FROM u.raw_app_meta_data->>'membership_number'
        OR p.membership_status IS DISTINCT FROM 'active')
  ) THEN
    RAISE EXCEPTION 'Membership profile guard did not derive the expected synthetic profile state';
  END IF;
END
$assert$;
