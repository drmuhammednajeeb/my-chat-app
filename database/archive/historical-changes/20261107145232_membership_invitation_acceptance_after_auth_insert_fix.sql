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
 update app_private.member_invitations set status='accepted',accepted_at=now()
 where id=v_inv.id and status='pending';
 if not found then raise exception 'تم استخدام هذه الدعوة أو إلغاؤها بالفعل'; end if;
 new.email:=v_email;
 new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||
  jsonb_build_object('membership_number',v_inv.membership_number,'membership_status','active');
 new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)-'membership_invite_code'-'membership_number';
 return new;
end;
$function$;

create or replace function app_private.create_profile_for_invited_user()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_base text; v_username text; v_display_name text; v_membership_number text;
begin
 v_membership_number:=new.raw_app_meta_data->>'membership_number';
 if v_membership_number is null then raise exception 'الحساب لا يحمل رقم عضوية صالحاً'; end if;
 update app_private.member_invitations set accepted_by=new.id
 where membership_number=v_membership_number and status='accepted' and accepted_by is null;
 if not found then raise exception 'تعذر تثبيت صاحب الدعوة على حساب العضوية'; end if;
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
