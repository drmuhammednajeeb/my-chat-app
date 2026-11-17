-- Enforce the signup display-name contract inside Auth, not only in the browser.
-- This is a forward-only migration; it does not modify existing member profiles.
create or replace function app_private.enforce_invited_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv app_private.member_invitations%rowtype;
  v_email text;
  v_code text;
  v_membership_number text;
  v_display_name text;
  v_name_parts text[];
begin
  -- Validate and normalize the submitted name before locking or consuming an invite.
  v_display_name := regexp_replace(
    btrim(coalesce(new.raw_user_meta_data->>'display_name', '')),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if v_display_name = '' or char_length(v_display_name) > 48 then
    raise exception 'أدخل اسمك ولقبك أو اسمك الثلاثي (بحد أقصى 48 حرفاً)';
  end if;

  v_name_parts := regexp_split_to_array(v_display_name, ' ');
  if cardinality(v_name_parts) not between 2 and 3
     or exists (
       select 1
       from unnest(v_name_parts) as submitted_part
       where submitted_part !~ '^[[:alpha:]]+([''’-][[:alpha:]]+)*$'
     ) then
    raise exception 'الاسم يجب أن يتكون من اسمين أو ثلاثة أسماء حقيقية، دون أرقام أو رموز';
  end if;

  v_email := lower(btrim(coalesce(new.email, '')));
  v_code := nullif(btrim(coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'membership_invite_code'), '');
  v_membership_number := nullif(btrim(coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'membership_number'), '');

  if v_email = '' or v_code is null or v_membership_number is null then
    raise exception 'التسجيل مغلق. يلزم بريد الدعوة ورقم العضوية ورمز الدعوة المعتمد';
  end if;

  if v_membership_number !~ '^971[0-9]{9}
  from app_private.member_invitations i
  where i.email = v_email
    and i.membership_number = v_membership_number
    and i.invite_code::text = v_code
    and i.status = 'pending'
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'الدعوة غير صحيحة أو منتهية أو سبق استخدامها';
  end if;

  update app_private.member_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id and status = 'pending';

  if not found then
    raise exception 'تم استخدام هذه الدعوة أو إلغاؤها بالفعل';
  end if;

  new.email := v_email;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'membership_number', v_inv.membership_number,
      'membership_number_verified', true,
      'membership_status', 'active'
    );
  new.raw_user_meta_data := (
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
    - 'membership_invite_code'
    - 'membership_number'
  ) || jsonb_build_object('display_name', v_display_name);

  return new;
end;
$function$;

revoke all on function app_private.enforce_invited_auth_signup() from public, anon, authenticated;
 then
    raise exception 'رقم العضوية الرسمي يجب أن يبدأ بـ 971 ويتبعه تسعة أرقام';
  end if;

  select i.* into v_inv
  from app_private.member_invitations i
  where i.email = v_email
    and i.membership_number = v_membership_number
    and i.invite_code::text = v_code
    and i.status = 'pending'
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'الدعوة غير صحيحة أو منتهية أو سبق استخدامها';
  end if;

  update app_private.member_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id and status = 'pending';

  if not found then
    raise exception 'تم استخدام هذه الدعوة أو إلغاؤها بالفعل';
  end if;

  new.email := v_email;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('membership_number', v_inv.membership_number, 'membership_status', 'active');
  new.raw_user_meta_data := (
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
    - 'membership_invite_code'
    - 'membership_number'
  ) || jsonb_build_object('display_name', v_display_name);

  return new;
end;
$function$;

revoke all on function app_private.enforce_invited_auth_signup() from public, anon, authenticated;
