-- Keep exposed channel RPCs SECURITY INVOKER; privileged work stays in app_private.
create or replace function app_private.discover_public_channels(
  p_search text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  description text,
  avatar_path text,
  member_count bigint,
  is_member boolean,
  created_at timestamptz,
  is_public boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  return query
  select c.id,c.title,c.description,c.avatar_path,
         count(m.user_id)::bigint,
         coalesce(bool_or(m.user_id = actor),false),
         c.created_at,c.is_public
    from public.conversations c
    left join public.conversation_members m on m.conversation_id = c.id
   where c.type = 'channel'
     and c.is_public = true
     and (
       nullif(btrim(p_search),'') is null
       or c.title ilike '%' || btrim(p_search) || '%'
       or c.description ilike '%' || btrim(p_search) || '%'
     )
   group by c.id
   order by c.created_at desc
   limit greatest(1,least(coalesce(p_limit,40),100))
   offset greatest(coalesce(p_offset,0),0);
end;
$function$;

create or replace function app_private.join_public_channel(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and c.type = 'channel'
       and c.is_public = true
  ) then
    raise exception 'القناة غير عامة أو غير متاحة';
  end if;
  insert into public.conversation_members(conversation_id,user_id,role)
  values (p_conversation_id,actor,'member')
  on conflict (conversation_id,user_id) do nothing;
  return p_conversation_id;
end;
$function$;

create or replace function public.discover_public_channels(
  p_search text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  description text,
  avatar_path text,
  member_count bigint,
  is_member boolean,
  created_at timestamptz,
  is_public boolean
)
language sql
stable
set search_path = ''
as $function$
  select * from app_private.discover_public_channels(p_search,p_limit,p_offset);
$function$;

create or replace function public.join_public_channel(p_conversation_id uuid)
returns uuid
language sql
set search_path = ''
as $function$
  select app_private.join_public_channel(p_conversation_id);
$function$;

revoke all on function public.discover_public_channels(text,integer,integer) from public,anon;
revoke all on function public.join_public_channel(uuid) from public,anon;
revoke all on function app_private.discover_public_channels(text,integer,integer) from public,anon;
revoke all on function app_private.join_public_channel(uuid) from public,anon;
grant execute on function app_private.discover_public_channels(text,integer,integer) to authenticated;
grant execute on function app_private.join_public_channel(uuid) to authenticated;
grant execute on function public.discover_public_channels(text,integer,integer) to authenticated;
grant execute on function public.join_public_channel(uuid) to authenticated;