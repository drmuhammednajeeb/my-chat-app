-- TEST ONLY. Exercises the Auth BEFORE INSERT guard and AFTER INSERT profile trigger.
-- Every row is synthetic and the complete probe is rolled back.
begin;

insert into app_private.member_invitations (
  email, membership_number, invite_code, status, created_by, expires_at
) values
  ('signup-two-part@bizmindmakers.test', '971001999991', '99999999-1111-4111-8111-111111111111', 'pending',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('signup-three-part@bizmindmakers.test', '971001999992', '99999999-2222-4222-8222-222222222222', 'pending',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day');

do $signup_name_test$
declare
  v_status text;
  v_profile_name text;
begin
  -- A one-part name must fail before the invite is consumed.
  begin
    insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '22222222-2222-4222-8222-222222222221', 'authenticated', 'authenticated',
      'signup-two-part@bizmindmakers.test', '', now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'username', 'signup_two_part',
        'display_name', 'محمد',
        'membership_number', '971001999991',
        'membership_invite_code', '99999999-1111-4111-8111-111111111111'
      )
    );
    raise exception 'A one-part signup name was unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%الاسم يجب أن يتكون%' then raise; end if;
  end;

  select status into v_status
  from app_private.member_invitations
  where email = 'signup-two-part@bizmindmakers.test';
  if v_status <> 'pending' then
    raise exception 'Invalid name consumed the invitation before validation';
  end if;

  -- Digits are rejected as name content; the same invitation remains reusable.
  begin
    insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
      'signup-two-part@bizmindmakers.test', '', now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'username', 'signup_two_part',
        'display_name', 'محمد 123',
        'membership_number', '971001999991',
        'membership_invite_code', '99999999-1111-4111-8111-111111111111'
      )
    );
    raise exception 'A digit-containing signup name was unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%الاسم يجب أن يتكون%' then raise; end if;
  end;

  select status into v_status
  from app_private.member_invitations
  where email = 'signup-two-part@bizmindmakers.test';
  if v_status <> 'pending' then
    raise exception 'Digit-containing name consumed the invitation';
  end if;

  -- Four-part names are rejected by the same server-side rule.
  begin
    insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '22222222-2222-4222-8222-222222222225', 'authenticated', 'authenticated',
      'signup-two-part@bizmindmakers.test', '', now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'username', 'signup_two_part',
        'display_name', 'محمد أحمد علي النبهاني',
        'membership_number', '971001999991',
        'membership_invite_code', '99999999-1111-4111-8111-111111111111'
      )
    );
    raise exception 'A four-part signup name was unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%الاسم يجب أن يتكون%' then raise; end if;
  end;

  select status into v_status
  from app_private.member_invitations
  where email = 'signup-two-part@bizmindmakers.test';
  if v_status <> 'pending' then
    raise exception 'Four-part name consumed the invitation';
  end if;

  -- Two-part Arabic name is accepted, whitespace is normalized, and the profile is correct.
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '22222222-2222-4222-8222-222222222223', 'authenticated', 'authenticated',
    'signup-two-part@bizmindmakers.test', '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object(
      'username', 'signup_two_part',
      'display_name', '  محمد   النبهاني  ',
      'membership_number', '971001999991',
      'membership_invite_code', '99999999-1111-4111-8111-111111111111'
    )
  );

  select display_name into v_profile_name
  from public.profiles
  where id = '22222222-2222-4222-8222-222222222223';
  if v_profile_name is distinct from 'محمد النبهاني' then
    raise exception 'Two-part Arabic display name was not normalized and saved correctly';
  end if;

  select status into v_status
  from app_private.member_invitations
  where email = 'signup-two-part@bizmindmakers.test';
  if v_status <> 'accepted' then
    raise exception 'Valid two-part name did not complete invitation acceptance';
  end if;

  -- Three-part Latin name is also accepted.
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '22222222-2222-4222-8222-222222222224', 'authenticated', 'authenticated',
    'signup-three-part@bizmindmakers.test', '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object(
      'username', 'signup_three_part',
      'display_name', 'Mohammed Ahmed Alnabhani',
      'membership_number', '971001999992',
      'membership_invite_code', '99999999-2222-4222-8222-222222222222'
    )
  );

  select display_name into v_profile_name
  from public.profiles
  where id = '22222222-2222-4222-8222-222222222224';
  if v_profile_name is distinct from 'Mohammed Ahmed Alnabhani' then
    raise exception 'Three-part Latin display name was not saved correctly';
  end if;
end
$signup_name_test$;

rollback;
