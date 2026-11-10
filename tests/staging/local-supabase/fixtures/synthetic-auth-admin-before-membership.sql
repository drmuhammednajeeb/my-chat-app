-- TEST ONLY. Apply after core schema exists and before team_management_dashboard.sql.
-- Uses a reserved .test address and a synthetic member number; never production identity.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  'authenticated', 'authenticated', 'admin@bizmindmakers.test', '',
  now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'membership_number', '971001000001',
    'membership_number_verified', true
  ),
  jsonb_build_object('username', 'test_admin', 'display_name', 'Test Admin')
)
on conflict (id) do nothing;
