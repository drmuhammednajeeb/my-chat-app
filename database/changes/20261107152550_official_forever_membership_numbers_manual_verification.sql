-- Official Forever Living membership IDs are supplied by the authorized team administrator.
-- Format: 971001 followed by six digits. The app never generates membership numbers.

alter table public.profiles
  add column if not exists membership_number_verified boolean not null default false;
alter table public.profiles drop constraint if exists profiles_membership_number_official_format;
alter table public.profiles add constraint profiles_membership_number_official_format
  check (membership_number is null or membership_number ~ '^971001[0-9]{6}$');

-- Do not treat previously auto-assigned values as official.
update public.profiles
set membership_number_verified = (membership_number = '971001726361'),
    updated_at = now();

alter table app_private.member_invitations drop constraint if exists member_invitation_number_format;
alter table app_private.member_invitations add constraint member_invitation_number_format
  check (membership_number ~ '^971001[0-9]{6}$');
alter table app_private.member_invitations drop constraint if exists member_invitations_membership_number_key;
create unique index if not exists member_invitations_active_membership_number_uidx
  on app_private.member_invitations(membership_number) where status in ('pending','accepted');

create or replace function app_private.is_active_member()
returns boolean language sql stable security definer set search_path=''
as $function$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=(select auth.uid()) and p.membership_status='active'
    and p.membership_number_verified=true
    and p.membership_number ~ '^971001[0-9]{6}$'
    and u.email_confirmed_at is not null);
$function$;
revoke all on function app_private.is_active_member() from public,anon;
grant execute on function app_private.is_active_member() to authenticated;

create or replace function app_private.guard_profile_membership_fields()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_number text; v_verified boolean;
begin
 if tg_op='INSERT' then
  select u.raw_app_meta_data->>'membership_number',
         coalesce((u.raw_app_meta_data->>'membership_number_verified')::boolean,false)
  into v_number,v_verified from auth.users u where u.id=new.id;
  if v_number is null or v_number !~ '^971001[0-9]{6}$' or v_verified is distinct from true then
   raise exception 'لا يمكن إنشاء ملف شخصي دون رقم عضوية فوريفر رسمي معتمد';
  end if;
  new.membership_number:=v_number;
  new.membership_number_verified:=true;
  new.membership_status:='active';
  return new;
 end if;
 if (new.membership_number is distinct from old.membership_number
     or new.membership_number_verified is distinct from old.membership_number_verified)
    and not app_private.is_team_admin() then
  raise exception 'تعديل رقم العضوية الرسمية واعتمادها من صلاحية مسؤول المنصة فقط';
 end if;
 if new.membership_number_verified and
    (new.membership_number is null or new.membership_number !~ '^971001[0-9]{6}$') then
  raise exception 'رقم العضوية يجب أن يبدأ بـ 971001 ويتبعه ستة أرقام';
 end if;
 if new.membership_status is distinct from old.membership_status and not app_private.is_team_admin() then
  raise exception 'لا تملك صلاحية تغيير حالة العضوية';
 end if;
 return new;
end;
$function$;
revoke all on function app_private.guard_profile_membership_fields() from public,anon,authenticated;

create or replace function app_private.enforce_invited_auth_signup()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_inv app_private.member_invitations%rowtype; v_email text; v_code text; v_number text;
begin
 v_email:=lower(btrim(coalesce(new.email,'')));
 v_code:=nullif(btrim(coalesce(new.raw_user_meta_data,'{}'::jsonb)->>'membership_invite_code'),'');
 v_number:=nullif(btrim(coalesce(new.raw_user_meta_data,'{}'::jsonb)->>'membership_number'),'');
 if v_email='' or v_code is null or v_number is null then
  raise exception 'التسجيل مغلق. يلزم بريد الدعوة ورقم عضوية فوريفر الرسمي ورمز الدعوة المعتمد';
 end if;
 if v_number !~ '^971001[0-9]{6}$' then
  raise exception 'رقم العضوية الرسمي يجب أن يبدأ بـ 971001 ويتبعه ستة أرقام';
 end if;
 select i.* into v_inv from app_private.member_invitations i
 where i.email=v_email and i.membership_number=v_number and i.invite_code::text=v_code
  and i.status='pending' and i.expires_at>now() for update;
 if not found then raise exception 'الدعوة غير صحيحة أو منتهية أو سبق استخدامها'; end if;
 update app_private.member_invitations set status='accepted',accepted_at=now()
 where id=v_inv.id and status='pending';
 if not found then raise exception 'تم استخدام هذه الدعوة أو إلغاؤها بالفعل'; end if;
 new.email:=v_email;
 new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||
  jsonb_build_object('membership_number',v_inv.membership_number,
   'membership_number_verified',true,'membership_status','active');
 new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)
  -'membership_invite_code'-'membership_number';
 return new;
end;
$function$;
revoke all on function app_private.enforce_invited_auth_signup() from public,anon,authenticated;

create or replace function app_private.create_profile_for_invited_user()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_base text; v_username text; v_display_name text; v_number text;
begin
 v_number:=new.raw_app_meta_data->>'membership_number';
 if v_number is null or v_number !~ '^971001[0-9]{6}$'
   or coalesce((new.raw_app_meta_data->>'membership_number_verified')::boolean,false) is distinct from true then
  raise exception 'الحساب لا يحمل رقم عضوية فوريفر رسمي معتمداً';
 end if;
 update app_private.member_invitations set accepted_by=new.id
 where membership_number=v_number and status='accepted' and accepted_by is null;
 if not found then raise exception 'تعذر تثبيت صاحب الدعوة على حساب العضوية'; end if;
 v_base:=regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username',split_part(new.email,'@',1))),
  '[^a-z0-9_]','','g');
 if length(v_base)<3 then v_base:='member_'||left(replace(new.id::text,'-',''),8); end if;
 v_username:=left(v_base,24);
 if exists(select 1 from public.profiles p where p.username=v_username) then
  v_username:=left(v_base,15)||'_'||left(replace(new.id::text,'-',''),8);
 end if;
 v_display_name:=left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),split_part(new.email,'@',1),'عضو'),48);
 insert into public.profiles(id,username,display_name,membership_number,membership_number_verified,membership_status)
 values(new.id,v_username,v_display_name,v_number,true,'active');
 return new;
end;
$function$;
revoke all on function app_private.create_profile_for_invited_user() from public,anon,authenticated;

-- Disable the old API that generated sequential IDs.
create or replace function public.admin_create_member_invites(p_emails text[])
returns table(email text,membership_number text,invitation_code uuid,expires_at timestamptz)
language plpgsql security invoker set search_path=''
as $function$
begin
 raise exception 'توقف إنشاء الأرقام تلقائياً. أدخل رقم عضوية فوريفر الرسمي لكل بريد عبر admin_create_official_member_invites';
end;
$function$;
revoke all on function app_private.admin_create_member_invites_impl(text[]) from public,anon,authenticated;
revoke all on function public.admin_create_member_invites(text[]) from public,anon;
grant execute on function public.admin_create_member_invites(text[]) to authenticated;

create or replace function app_private.admin_create_official_member_invites_impl(p_members jsonb)
returns table(email text,membership_number text,invitation_code uuid,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare v_item jsonb; v_email text; v_number text; v_code uuid; v_expiry timestamptz;
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 if p_members is null or jsonb_typeof(p_members)<>'array'
   or jsonb_array_length(p_members)<1 or jsonb_array_length(p_members)>1000 then
  raise exception 'أدخل من 1 إلى 1,000 زوجاً من البريد ورقم العضوية الرسمية';
 end if;
 if exists(select 1 from (
  select lower(btrim(x.value->>'email')) as email
  from jsonb_array_elements(p_members) x(value)
 ) d group by d.email having count(*)>1) then
  raise exception 'توجد عناوين بريد مكررة في الدفعة';
 end if;
 if exists(select 1 from (
  select btrim(x.value->>'membership_number') as membership_number
  from jsonb_array_elements(p_members) x(value)
 ) d group by d.membership_number having count(*)>1) then
  raise exception 'توجد أرقام عضوية مكررة في الدفعة';
 end if;
 for v_item in select value from jsonb_array_elements(p_members) loop
  v_email:=lower(btrim(coalesce(v_item->>'email','')));
  v_number:=btrim(coalesce(v_item->>'membership_number',''));
  if v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
   raise exception 'صيغة البريد الإلكتروني غير صحيحة: %',v_email;
  end if;
  if v_number !~ '^971001[0-9]{6}$' then
   raise exception 'رقم العضوية غير مطابق للصيغة الرسمية 971001XXXXXX: %',v_number;
  end if;
  if exists(select 1 from auth.users u where lower(u.email)=v_email) then
   raise exception 'هذا البريد لديه حساب بالفعل: %',v_email;
  end if;
  if exists(select 1 from public.profiles p where p.membership_number=v_number) then
   raise exception 'رقم العضوية مستخدم في حساب موجود: %',v_number;
  end if;
  update app_private.member_invitations i set status='expired'
  where i.email=v_email and i.status='pending' and i.expires_at<=now();
  if exists(select 1 from app_private.member_invitations i
    where i.email=v_email and i.status='pending' and i.expires_at>now()) then
   raise exception 'توجد دعوة سارية بالفعل لهذا البريد: %',v_email;
  end if;
  if exists(select 1 from app_private.member_invitations i
    where i.membership_number=v_number and i.status in ('pending','accepted')) then
   raise exception 'رقم العضوية مرتبط بدعوة أخرى أو مستخدم بالفعل: %',v_number;
  end if;
  insert into app_private.member_invitations(email,membership_number,created_by)
  values(v_email,v_number,(select auth.uid()))
  returning invite_code,app_private.member_invitations.expires_at into v_code,v_expiry;
  email:=v_email; membership_number:=v_number; invitation_code:=v_code; expires_at:=v_expiry;
  return next;
 end loop;
end;
$function$;
revoke all on function app_private.admin_create_official_member_invites_impl(jsonb) from public,anon;
grant execute on function app_private.admin_create_official_member_invites_impl(jsonb) to authenticated;

create or replace function public.admin_create_official_member_invites(p_members jsonb)
returns table(email text,membership_number text,invitation_code uuid,expires_at timestamptz)
language sql security invoker set search_path=''
as $function$ select * from app_private.admin_create_official_member_invites_impl(p_members); $function$;
revoke all on function public.admin_create_official_member_invites(jsonb) from public,anon;
grant execute on function public.admin_create_official_member_invites(jsonb) to authenticated;

create or replace function app_private.admin_set_member_official_number_impl(p_user_id uuid,p_membership_number text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: اعتماد رقم العضوية للمسؤول فقط'; end if;
 if p_membership_number is null or p_membership_number !~ '^971001[0-9]{6}$' then
  raise exception 'رقم العضوية يجب أن يبدأ بـ 971001 ويتبعه ستة أرقام';
 end if;
 if exists(select 1 from public.profiles p where p.membership_number=p_membership_number and p.id<>p_user_id) then
  raise exception 'رقم العضوية مرتبط بحساب آخر';
 end if;
 if exists(select 1 from app_private.member_invitations i
  where i.membership_number=p_membership_number and i.status in ('pending','accepted')
   and i.accepted_by is distinct from p_user_id) then
  raise exception 'رقم العضوية محجوز لدعوة أو حساب آخر';
 end if;
 update public.profiles set membership_number=p_membership_number,
  membership_number_verified=true,updated_at=now() where id=p_user_id;
 if not found then raise exception 'العضو غير موجود'; end if;
end;
$function$;
revoke all on function app_private.admin_set_member_official_number_impl(uuid,text) from public,anon;
grant execute on function app_private.admin_set_member_official_number_impl(uuid,text) to authenticated;

create or replace function public.admin_set_member_official_number(p_user_id uuid,p_membership_number text)
returns void language sql security invoker set search_path=''
as $function$ select app_private.admin_set_member_official_number_impl(p_user_id,p_membership_number); $function$;
revoke all on function public.admin_set_member_official_number(uuid,text) from public,anon;
grant execute on function public.admin_set_member_official_number(uuid,text) to authenticated;

create or replace function app_private.admin_list_memberships_impl()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 select jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object(
   'user_id',p.id,'email',u.email,'username',p.username,'display_name',p.display_name,
   'membership_number',p.membership_number,'membership_number_verified',p.membership_number_verified,
   'membership_status',p.membership_status,'created_at',p.created_at
  ) order by p.membership_number nulls last) from public.profiles p join auth.users u on u.id=p.id),'[]'::jsonb),
  'pending_invites',coalesce((select jsonb_agg(jsonb_build_object(
   'id',i.id,'email',i.email,'membership_number',i.membership_number,'expires_at',i.expires_at
  ) order by i.created_at desc) from app_private.member_invitations i
  where i.status='pending' and i.expires_at>now()),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$function$;
revoke all on function app_private.admin_list_memberships_impl() from public,anon;
grant execute on function app_private.admin_list_memberships_impl() to authenticated;

create or replace function public.admin_list_memberships()
returns jsonb language sql security invoker set search_path=''
as $function$ select app_private.admin_list_memberships_impl(); $function$;
revoke all on function public.admin_list_memberships() from public,anon;
grant execute on function public.admin_list_memberships() to authenticated;

create or replace function public.get_my_membership_state()
returns jsonb language sql stable security invoker set search_path=''
as $function$
 select coalesce((select jsonb_build_object(
  'membership_number',p.membership_number,
  'membership_number_verified',p.membership_number_verified,
  'membership_status',p.membership_status,
  'email_verified',(u.email_confirmed_at is not null))
  from public.profiles p join auth.users u on u.id=p.id where p.id=(select auth.uid())
 ),jsonb_build_object('membership_number',null,'membership_number_verified',false,
  'membership_status',null,'email_verified',false));
$function$;
revoke all on function public.get_my_membership_state() from public,anon;
grant execute on function public.get_my_membership_state() to authenticated;
