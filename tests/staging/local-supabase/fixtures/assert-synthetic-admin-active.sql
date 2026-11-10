-- TEST ONLY. Run after the final membership format migration.
-- This is an assertion only; it does not modify the synthetic user.
do $check$
begin
  if not exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = '11111111-1111-4111-8111-111111111111'::uuid
      and p.membership_number = '971001000001'
      and p.membership_number_verified = true
      and p.membership_status = 'active'
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Synthetic admin is not an active verified member after the final format migration.';
  end if;
end
$check$;
