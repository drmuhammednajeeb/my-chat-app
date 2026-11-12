create or replace function app_private.admin_create_member_invites_impl(p_emails text[])
returns table(email text,membership_number text,invitation_code uuid,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare v_email text; v_number text; v_code uuid; v_expiry timestamptz;
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 if p_emails is null or cardinality(p_emails)<1 or cardinality(p_emails)>1000 then
  raise exception 'أدخل من 1 إلى 1000 بريداً إلكترونياً في الدفعة الواحدة';
 end if;
 if exists(select 1 from unnest(p_emails) as x(value) group by lower(btrim(x.value)) having count(*)>1) then
  raise exception 'توجد عناوين بريد مكررة في القائمة';
 end if;
 foreach v_email in array p_emails loop
  v_email:=lower(btrim(coalesce(v_email,'')));
  if v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
   raise exception 'صيغة بريد إلكتروني غير صحيحة: %',v_email;
  end if;
  if exists(select 1 from auth.users u where lower(u.email)=v_email) then
   raise exception 'هذا البريد لديه حساب بالفعل: %',v_email;
  end if;
  update app_private.member_invitations mi set status='expired'
  where mi.email=v_email and mi.status='pending' and mi.expires_at<=now();
  if exists(select 1 from app_private.member_invitations mi where mi.email=v_email and mi.status='pending' and mi.expires_at>now()) then
   raise exception 'توجد دعوة سارية بالفعل لهذا البريد: %',v_email;
  end if;
  v_number:='971'||lpad(nextval('app_private.membership_number_seq'::regclass)::text,9,'0');
  insert into app_private.member_invitations as mi(email,membership_number,created_by)
  values(v_email,v_number,(select auth.uid()))
  returning mi.invite_code,mi.expires_at into v_code,v_expiry;
  email:=v_email; membership_number:=v_number; invitation_code:=v_code; expires_at:=v_expiry; return next;
 end loop;
end;
$function$;

create or replace function app_private.admin_list_memberships_impl()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 select jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object(
   'user_id',p.id,'email',u.email,'username',p.username,'display_name',p.display_name,
   'membership_number',p.membership_number,'membership_status',p.membership_status,'created_at',p.created_at
  ) order by p.membership_number) from public.profiles p join auth.users u on u.id=p.id),'[]'::jsonb),
  'pending_invites',coalesce((select jsonb_agg(jsonb_build_object(
   'id',mi.id,'email',mi.email,'membership_number',mi.membership_number,'expires_at',mi.expires_at
  ) order by mi.created_at desc) from app_private.member_invitations mi
  where mi.status='pending' and mi.expires_at>now()),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$function$;

create or replace function app_private.admin_update_membership_status_impl(p_user_id uuid,p_status text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 if p_status not in ('active','suspended') then raise exception 'حالة العضوية غير صالحة'; end if;
 if p_user_id=(select auth.uid()) then raise exception 'لا يمكن إيقاف عضوية المسؤول الذي يدير النظام من حسابه الحالي'; end if;
 if exists(select 1 from app_private.team_admins a where a.user_id=p_user_id) then
  raise exception 'لا يمكن تغيير حالة حساب مسؤول من شاشة إدارة الأعضاء';
 end if;
 update public.profiles set membership_status=p_status,updated_at=now() where id=p_user_id;
 if not found then raise exception 'العضوية المطلوبة غير موجودة'; end if;
end;
$function$;

create or replace function app_private.admin_revoke_member_invite_impl(p_invite_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 update app_private.member_invitations set status='revoked',revoked_at=now()
 where id=p_invite_id and status='pending';
 if not found then raise exception 'الدعوة غير موجودة أو لم تعد سارية'; end if;
end;
$function$;

revoke all on function app_private.admin_create_member_invites_impl(text[]) from public,anon;
revoke all on function app_private.admin_list_memberships_impl() from public,anon;
revoke all on function app_private.admin_update_membership_status_impl(uuid,text) from public,anon;
revoke all on function app_private.admin_revoke_member_invite_impl(uuid) from public,anon;
grant execute on function app_private.admin_create_member_invites_impl(text[]) to authenticated;
grant execute on function app_private.admin_list_memberships_impl() to authenticated;
grant execute on function app_private.admin_update_membership_status_impl(uuid,text) to authenticated;
grant execute on function app_private.admin_revoke_member_invite_impl(uuid) to authenticated;

create or replace function public.admin_create_member_invites(p_emails text[])
returns table(email text,membership_number text,invitation_code uuid,expires_at timestamptz)
language sql security invoker set search_path=''
as $function$ select * from app_private.admin_create_member_invites_impl(p_emails); $function$;
create or replace function public.admin_list_memberships()
returns jsonb language sql security invoker set search_path=''
as $function$ select app_private.admin_list_memberships_impl(); $function$;
create or replace function public.admin_update_membership_status(p_user_id uuid,p_status text)
returns void language sql security invoker set search_path=''
as $function$ select app_private.admin_update_membership_status_impl(p_user_id,p_status); $function$;
create or replace function public.admin_revoke_member_invite(p_invite_id uuid)
returns void language sql security invoker set search_path=''
as $function$ select app_private.admin_revoke_member_invite_impl(p_invite_id); $function$;

revoke all on function public.admin_create_member_invites(text[]) from public,anon;
revoke all on function public.admin_list_memberships() from public,anon;
revoke all on function public.admin_update_membership_status(uuid,text) from public,anon;
revoke all on function public.admin_revoke_member_invite(uuid) from public,anon;
grant execute on function public.admin_create_member_invites(text[]) to authenticated;
grant execute on function public.admin_list_memberships() to authenticated;
grant execute on function public.admin_update_membership_status(uuid,text) to authenticated;
grant execute on function public.admin_revoke_member_invite(uuid) to authenticated;
