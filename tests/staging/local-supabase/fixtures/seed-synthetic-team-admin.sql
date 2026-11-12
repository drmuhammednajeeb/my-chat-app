-- TEST ONLY: seed the synthetic administrator after the canonical team-admin schema exists.
-- The synthetic auth user is created by synthetic-auth-admin-before-membership.sql.
insert into app_private.team_admins(user_id)
select id from auth.users
where lower(email) = lower('admin@bizmindmakers.test')
on conflict (user_id) do nothing;
