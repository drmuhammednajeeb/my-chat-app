CREATE OR REPLACE FUNCTION app_private.admin_create_official_member_invites_impl(p_members jsonb)
 RETURNS TABLE(email text, membership_number text, invitation_code uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_email text;
  v_number text;
  v_code uuid;
  v_expiry timestamptz;
begin
  if not app_private.is_team_admin() then
    raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array'
     or jsonb_array_length(p_members) < 1 or jsonb_array_length(p_members) > 1000 then
    raise exception 'أدخل من 1 إلى 1,000 زوجاً من البريد ورقم العضوية الرسمية';
  end if;

  if exists (
    select 1 from (
      select lower(btrim(x.value ->> 'email')) as email
      from jsonb_array_elements(p_members) x(value)
    ) d group by d.email having count(*) > 1
  ) then
    raise exception 'توجد عناوين بريد مكررة في الدفعة';
  end if;

  if exists (
    select 1 from (
      select btrim(x.value ->> 'membership_number') as membership_number
      from jsonb_array_elements(p_members) x(value)
    ) d group by d.membership_number having count(*) > 1
  ) then
    raise exception 'توجد أرقام عضوية مكررة في الدفعة';
  end if;

  for v_item in select value from jsonb_array_elements(p_members)
  loop
    v_email := lower(btrim(coalesce(v_item ->> 'email', '')));
    v_number := btrim(coalesce(v_item ->> 'membership_number', ''));

    if v_email !~ '^[a-z0-9.!#$%&''*+/=?^_\`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      raise exception 'صيغة البريد الإلكتروني غير صحيحة: %', v_email;
    end if;
    if v_number !~ '^971001[0-9]{6}$' then
      raise exception 'رقم العضوية غير مطابق للصيغة الرسمية 971001XXXXXX: %', v_number;
    end if;
    if exists(select 1 from auth.users u where lower(u.email) = v_email) then
      raise exception 'هذا البريد لديه حساب بالفعل: %', v_email;
    end if;
    if exists(select 1 from public.profiles p where p.membership_number = v_number) then
      raise exception 'رقم العضوية مستخدم في حساب موجود: %', v_number;
    end if;

    update app_private.member_invitations i
    set status = 'expired'
    where i.email = v_email and i.status = 'pending' and i.expires_at <= now();

    if exists(
      select 1 from app_private.member_invitations i
      where i.email = v_email and i.status = 'pending' and i.expires_at > now()
    ) then
      raise exception 'توجد دعوة سارية بالفعل لهذا البريد: %', v_email;
    end if;
    if exists(
      select 1 from app_private.member_invitations i
      where i.membership_number = v_number and i.status in ('pending','accepted')
    ) then
      raise exception 'رقم العضوية مرتبط بدعوة أخرى أو مستخدم بالفعل: %', v_number;
    end if;

    insert into app_private.member_invitations(email, membership_number, created_by)
    values(v_email, v_number, (select auth.uid()))
    returning invite_code, app_private.member_invitations.expires_at into v_code, v_expiry;

    email := v_email;
    membership_number := v_number;
    invitation_code := v_code;
    expires_at := v_expiry;
    return next;
  end loop;
end;
$function$;

revoke all on function app_private.admin_create_official_member_invites_impl(jsonb) from public, anon;
grant execute on function app_private.admin_create_official_member_invites_impl(jsonb) to authenticated;
