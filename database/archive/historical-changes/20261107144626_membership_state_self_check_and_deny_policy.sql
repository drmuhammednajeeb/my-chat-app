drop policy if exists "No client access to private membership invitations" on app_private.member_invitations;
create policy "No client access to private membership invitations"
on app_private.member_invitations as permissive for all to authenticated
using(false) with check(false);

create or replace function app_private.get_my_membership_state_impl()
returns jsonb language sql stable security definer set search_path=''
as $function$
 select coalesce((
  select jsonb_build_object('membership_number',p.membership_number,
   'membership_status',p.membership_status,'email_verified',(u.email_confirmed_at is not null))
  from public.profiles p join auth.users u on u.id=p.id where p.id=(select auth.uid())
 ),jsonb_build_object('membership_number',null,'membership_status',null,'email_verified',false));
$function$;
revoke all on function app_private.get_my_membership_state_impl() from public,anon;
grant execute on function app_private.get_my_membership_state_impl() to authenticated;

create or replace function public.get_my_membership_state()
returns jsonb language sql stable security invoker set search_path=''
as $function$ select app_private.get_my_membership_state_impl(); $function$;
revoke all on function public.get_my_membership_state() from public,anon;
grant execute on function public.get_my_membership_state() to authenticated;
