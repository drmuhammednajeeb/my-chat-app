-- TEST ONLY. Run after membership.base installs the profile guard and before membership.official.
-- Auth rows are pre-seeded before auth.users membership triggers; this fixture creates profiles only.
-- The missing-profile Auth identity is deliberately omitted.

INSERT INTO public.profiles (id, username, display_name) VALUES
  ('22222222-2222-4222-8222-222222222201'::uuid, 'direct_a', 'Direct Test A'),
  ('22222222-2222-4222-8222-222222222202'::uuid, 'direct_b', 'Direct Test B'),
  ('22222222-2222-4222-8222-222222222203'::uuid, 'direct_suspended', 'Direct Test Suspended'),
  ('22222222-2222-4222-8222-222222222204'::uuid, 'direct_unverified', 'Direct Test Unverified'),
  ('22222222-2222-4222-8222-222222222205'::uuid, 'direct_unconfirmed', 'Direct Test Unconfirmed')
ON CONFLICT (id) DO NOTHING;

DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.profiles
      WHERE id IN (
        '22222222-2222-4222-8222-222222222201'::uuid,
        '22222222-2222-4222-8222-222222222202'::uuid,
        '22222222-2222-4222-8222-222222222203'::uuid,
        '22222222-2222-4222-8222-222222222204'::uuid,
        '22222222-2222-4222-8222-222222222205'::uuid
      )) <> 5 THEN
    RAISE EXCEPTION 'Synthetic direct-chat profile seed is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '22222222-2222-4222-8222-222222222206'::uuid
  ) THEN
    RAISE EXCEPTION 'Missing-profile test identity unexpectedly has a profile';
  END IF;
END
$assert$;
