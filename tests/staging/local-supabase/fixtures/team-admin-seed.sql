-- TEST ONLY. Run after membership.base and the synthetic admin profile fixture.
-- No production user or email is embedded in this fixture.
INSERT INTO app_private.team_admins(user_id)
SELECT id FROM auth.users
WHERE id = '11111111-1111-4111-8111-111111111111'::uuid
ON CONFLICT (user_id) DO NOTHING;

DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.team_admins WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid) THEN
    RAISE EXCEPTION 'Synthetic test administrator was not seeded';
  END IF;
END
$assert$;
