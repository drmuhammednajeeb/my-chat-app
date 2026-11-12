-- Recovered dependency closure for clean bootstrap:
-- these channel visibility columns and the team-admin boundary existed in production
-- before the membership RLS rewrite. Their original standalone SQL was not retained.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_type_check,
  DROP CONSTRAINT IF EXISTS conversations_check,
  DROP CONSTRAINT IF EXISTS conversations_description_length_check,
  DROP CONSTRAINT IF EXISTS conversations_only_channels_public;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_type_check
    CHECK (type = ANY (ARRAY['direct','group','channel'])),
  ADD CONSTRAINT conversations_check
    CHECK ((type='direct' AND title IS NULL)
      OR (type IN ('group','channel') AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 80)),
  ADD CONSTRAINT conversations_description_length_check CHECK (char_length(description) <= 500),
  ADD CONSTRAINT conversations_only_channels_public CHECK ((type='channel') OR (is_public=false));

CREATE TABLE IF NOT EXISTS app_private.team_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.team_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.team_admins FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS "Deny direct team admin table access" ON app_private.team_admins;
CREATE POLICY "Deny direct team admin table access"
ON app_private.team_admins FOR ALL TO authenticated USING (false) WITH CHECK (false);

create sequence if not exists app_private.membership_number_seq
  as bigint start with 1726363 increment by 1 minvalue 1 maxvalue 999999999 no cycle;

alter table public.profiles
  add column if not exists membership_number text,
  add column if not exists membership_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_membership_status_check;
alter table public.profiles add constraint profiles_membership_status_check
  check (membership_status in ('active','suspended'));

with ranked as (
  select p.id,row_number() over (
    order by case when p.id='adcb26d3-1a85-41e5-8efb-d7dbf3ba3dba'::uuid then 0 else 1 end,
             p.created_at,p.id
  ) rn
  from public.profiles p
)
update public.profiles p
set membership_number='971'||lpad((1726360+ranked.rn)::text,9,'0'),
    membership_status='active',updated_at=now()
from ranked
where ranked.id=p.id and (p.membership_number is null or p.membership_number='');

create unique index if not exists profiles_membership_number_uidx on public.profiles(membership_number);
select setval('app_private.membership_number_seq'::regclass,
  greatest(1726362,coalesce((
    select max(substring(membership_number from 4)::bigint)
    from public.profiles where membership_number ~ '^971[0-9]{9}$'
  ),1726362)),true);

create table if not exists app_private.member_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  membership_number text not null unique,
  invite_code uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '14 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint member_invitation_email_normalized check(email=lower(btrim(email))),
  constraint member_invitation_number_format check(membership_number ~ '^971[0-9]{9}$')
);
create unique index if not exists member_invitations_pending_email_uidx
  on app_private.member_invitations(email) where status='pending';
create index if not exists member_invitations_status_expiry_idx
  on app_private.member_invitations(status,expires_at);
alter table app_private.member_invitations enable row level security;
revoke all on table app_private.member_invitations from public,anon,authenticated;
revoke all on sequence app_private.membership_number_seq from public,anon,authenticated;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_active_member()
returns boolean language sql stable security definer set search_path=''
as $function$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=(select auth.uid()) and p.membership_status='active' and u.email_confirmed_at is not null);
$function$;
revoke all on function app_private.is_active_member() from public,anon;
grant execute on function app_private.is_active_member() to authenticated;

create or replace function app_private.is_conversation_member(target_conversation uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
 select app_private.is_active_member() and exists(
  select 1 from public.conversation_members cm
  where cm.conversation_id=target_conversation and cm.user_id=(select auth.uid()));
$function$;

create or replace function app_private.is_team_admin()
returns boolean language sql stable security definer set search_path=''
as $function$
 select app_private.is_active_member() and exists(
  select 1 from app_private.team_admins a where a.user_id=(select auth.uid()));
$function$;

create or replace function app_private.guard_profile_membership_fields()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_membership_number text;
begin
 if tg_op='INSERT' then
  select u.raw_app_meta_data->>'membership_number' into v_membership_number
  from auth.users u where u.id=new.id;
  if v_membership_number is null or v_membership_number !~ '^971[0-9]{9}$' then
   raise exception 'لا يمكن إنشاء ملف شخصي دون عضوية معتمدة';
  end if;
  new.membership_number:=v_membership_number;
  new.membership_status:='active';
  return new;
 end if;
 if new.membership_number is distinct from old.membership_number then
  raise exception 'رقم العضوية ثابت ولا يمكن تغييره';
 end if;
 if new.membership_status is distinct from old.membership_status and not app_private.is_team_admin() then
  raise exception 'لا تملك صلاحية تغيير حالة العضوية';
 end if;
 return new;
end;
$function$;
revoke all on function app_private.guard_profile_membership_fields() from public,anon,authenticated;
drop trigger if exists profiles_guard_membership_fields on public.profiles;
create trigger profiles_guard_membership_fields before insert or update on public.profiles
for each row execute function app_private.guard_profile_membership_fields();

create or replace function app_private.enforce_invited_auth_signup()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_inv app_private.member_invitations%rowtype; v_email text; v_code text; v_membership_number text;
begin
 v_email:=lower(btrim(coalesce(new.email,'')));
 v_code:=nullif(btrim(coalesce(new.raw_user_meta_data,'{}'::jsonb)->>'membership_invite_code'),'');
 v_membership_number:=nullif(btrim(coalesce(new.raw_user_meta_data,'{}'::jsonb)->>'membership_number'),'');
 if v_email='' or v_code is null or v_membership_number is null then
  raise exception 'التسجيل مغلق. يلزم بريد الدعوة ورقم العضوية ورمز الدعوة المعتمد';
 end if;
 select i.* into v_inv from app_private.member_invitations i
 where i.email=v_email and i.membership_number=v_membership_number and i.invite_code::text=v_code
  and i.status='pending' and i.expires_at>now() for update;
 if not found then raise exception 'الدعوة غير صحيحة أو منتهية أو سبق استخدامها'; end if;
 update app_private.member_invitations set status='accepted',accepted_by=new.id,accepted_at=now()
 where id=v_inv.id and status='pending';
 if not found then raise exception 'تم استخدام هذه الدعوة أو إلغاؤها بالفعل'; end if;
 new.email:=v_email;
 new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||
  jsonb_build_object('membership_number',v_inv.membership_number,'membership_status','active');
 new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)-'membership_invite_code'-'membership_number';
 return new;
end;
$function$;
revoke all on function app_private.enforce_invited_auth_signup() from public,anon,authenticated;

create or replace function app_private.create_profile_for_invited_user()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_base text; v_username text; v_display_name text; v_membership_number text;
begin
 v_membership_number:=new.raw_app_meta_data->>'membership_number';
 if v_membership_number is null then raise exception 'الحساب لا يحمل رقم عضوية صالحاً'; end if;
 v_base:=regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username',split_part(new.email,'@',1))),
  '[^a-z0-9_]','','g');
 if length(v_base)<3 then v_base:='member_'||left(replace(new.id::text,'-',''),8); end if;
 v_username:=left(v_base,24);
 if exists(select 1 from public.profiles p where p.username=v_username) then
  v_username:=left(v_base,15)||'_'||left(replace(new.id::text,'-',''),8);
 end if;
 v_display_name:=left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),split_part(new.email,'@',1),'عضو'),48);
 insert into public.profiles(id,username,display_name,membership_number,membership_status)
 values(new.id,v_username,v_display_name,v_membership_number,'active');
 return new;
end;
$function$;
revoke all on function app_private.create_profile_for_invited_user() from public,anon,authenticated;

drop trigger if exists auth_users_require_membership_invite on auth.users;
create trigger auth_users_require_membership_invite before insert on auth.users
for each row execute function app_private.enforce_invited_auth_signup();
drop trigger if exists auth_users_create_member_profile on auth.users;
create trigger auth_users_create_member_profile after insert on auth.users
for each row execute function app_private.create_profile_for_invited_user();

revoke insert,update on table public.profiles from authenticated;
grant update(username,display_name,avatar_url,bio,updated_at) on table public.profiles to authenticated;
drop policy if exists "Users create own profile" on public.profiles;

create or replace function public.admin_create_member_invites(p_emails text[])
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
  update app_private.member_invitations set status='expired'
  where email=v_email and status='pending' and expires_at<=now();
  if exists(select 1 from app_private.member_invitations i where i.email=v_email and i.status='pending' and i.expires_at>now()) then
   raise exception 'توجد دعوة سارية بالفعل لهذا البريد: %',v_email;
  end if;
  v_number:='971'||lpad(nextval('app_private.membership_number_seq'::regclass)::text,9,'0');
  insert into app_private.member_invitations(email,membership_number,created_by)
  values(v_email,v_number,(select auth.uid()))
  returning invite_code,app_private.member_invitations.expires_at into v_code,v_expiry;
  email:=v_email; membership_number:=v_number; invitation_code:=v_code; expires_at:=v_expiry; return next;
 end loop;
end;
$function$;

create or replace function public.admin_list_memberships()
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
   'id',i.id,'email',i.email,'membership_number',i.membership_number,'expires_at',i.expires_at
  ) order by i.created_at desc) from app_private.member_invitations i
  where i.status='pending' and i.expires_at>now()),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$function$;

create or replace function public.admin_update_membership_status(p_user_id uuid,p_status text)
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

create or replace function public.admin_revoke_member_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not app_private.is_team_admin() then raise exception 'غير مصرح: إدارة العضويات للمسؤول فقط'; end if;
 update app_private.member_invitations set status='revoked',revoked_at=now()
 where id=p_invite_id and status='pending';
 if not found then raise exception 'الدعوة غير موجودة أو لم تعد سارية'; end if;
end;
$function$;
revoke all on function public.admin_create_member_invites(text[]) from public,anon;
revoke all on function public.admin_list_memberships() from public,anon;
revoke all on function public.admin_update_membership_status(uuid,text) from public,anon;
revoke all on function public.admin_revoke_member_invite(uuid) from public,anon;
grant execute on function public.admin_create_member_invites(text[]) to authenticated;
grant execute on function public.admin_list_memberships() to authenticated;
grant execute on function public.admin_update_membership_status(uuid,text) to authenticated;
grant execute on function public.admin_revoke_member_invite(uuid) to authenticated;

do $block$
declare r record; v_roles text; v_qual text; v_check text; v_sql text;
begin
 for r in select * from pg_policies where schemaname in ('public','storage') and 'authenticated'=any(roles) loop
  select string_agg(quote_ident(role_name::text),', ') into v_roles from unnest(r.roles) as role_name;
  v_qual:=case when r.qual is null then null else '('||r.qual||') AND (select app_private.is_active_member())' end;
  v_check:=case when r.with_check is null then null else '('||r.with_check||') AND (select app_private.is_active_member())' end;
  execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  v_sql:=format('create policy %I on %I.%I as permissive for %s to %s%s%s',
   r.policyname,r.schemaname,r.tablename,r.cmd,v_roles,
   case when v_qual is null then '' else format(' using (%s)',v_qual) end,
   case when v_check is null then '' else format(' with check (%s)',v_check) end);
  execute v_sql;
 end loop;
end;
$block$;
