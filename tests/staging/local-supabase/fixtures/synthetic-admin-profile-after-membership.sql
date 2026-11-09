-- TEST ONLY. Apply immediately after the membership base SQL has installed its profile guard.
-- The trigger derives membership_number and membership_status from the synthetic Auth metadata.
insert into public.profiles (id, username, display_name)
values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  'test_admin',
  'Test Admin'
)
on conflict (id) do nothing;
