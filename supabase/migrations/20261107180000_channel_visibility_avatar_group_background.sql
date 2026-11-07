-- Public/private channels, protected groups, channel avatars, and shared group wallpapers.
alter table public.conversations
  add column if not exists avatar_path text;

update public.conversations
   set is_public = false
 where type <> 'channel' and is_public = true;

alter table public.conversations
  alter column is_public set default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_only_channels_public'
  ) then
    alter table public.conversations
      add constraint conversations_only_channels_public
      check (type = 'channel' or is_public = false);
  end if;
end $$;

alter table public.conversation_group_settings
  add column if not exists background_theme text not null default 'default';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_group_settings'::regclass
      and conname = 'conversation_group_background_theme_allowed'
  ) then
    alter table public.conversation_group_settings
      add constraint conversation_group_background_theme_allowed
      check (background_theme in ('default','sand','mint','lavender','slate','midnight'));
  end if;
end $$;

create or replace function app_private.create_channel(
  p_title text,
  p_description text default '',
  p_is_public boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  new_id uuid;
begin
  if actor is null or not app_private.is_active_member() then
    raise exception 'يجب تسجيل الدخول بحساب عضوية نشط';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'اسم القناة يجب أن يكون بين 1 و80 حرفاً';
  end if;
  if coalesce(char_length(p_description), 0) > 500 then
    raise exception 'وصف القناة يتجاوز 500 حرف';
  end if;

  insert into public.conversations(type,title,description,is_public,created_by)
  values ('channel',btrim(p_title),coalesce(btrim(p_description),''),coalesce(p_is_public,false),actor)
  returning id into new_id;

  insert into public.conversation_members(conversation_id,user_id,role)
  values (new_id,actor,'owner');

  return new_id;
end;
$function$;

create or replace function app_private.create_private_channel(
  p_title text,
  p_description text default ''
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select app_private.create_channel(p_title,p_description,false);
$function$;

create or replace function public.create_channel(
  p_title text,
  p_description text default '',
  p_is_public boolean default false
)
returns uuid
language sql
set search_path = ''
as $function$
  select app_private.create_channel(p_title,p_description,p_is_public);
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

create or replace function public.join_public_channel(p_conversation_id uuid)
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

create or replace function app_private.can_access_channel_avatar(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select app_private.is_active_member()
     and exists (
       select 1
         from public.conversations c
        where c.id = target_conversation
          and c.type = 'channel'
          and (
            c.is_public = true
            or exists (
              select 1 from public.conversation_members m
               where m.conversation_id = c.id
                 and m.user_id = (select auth.uid())
            )
          )
     );
$function$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('channel-avatars','channel-avatars',false,3145728,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Channel members read channel avatars" on storage.objects;
create policy "Channel members read channel avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'channel-avatars'
  and app_private.can_access_channel_avatar(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Channel admins upload channel avatars" on storage.objects;
create policy "Channel admins upload channel avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  and (select app_private.is_active_member())
);

drop policy if exists "Channel admins update channel avatars" on storage.objects;
create policy "Channel admins update channel avatars"
on storage.objects for update to authenticated
using (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  and (select app_private.is_active_member())
)
with check (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  and (select app_private.is_active_member())
);

drop policy if exists "Channel admins delete channel avatars" on storage.objects;
create policy "Channel admins delete channel avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
  and (select app_private.is_active_member())
);

revoke all on function app_private.create_channel(text,text,boolean) from public,anon;
revoke all on function app_private.can_access_channel_avatar(uuid) from public,anon;
revoke all on function public.create_channel(text,text,boolean) from public,anon;
revoke all on function public.discover_public_channels(text,integer,integer) from public,anon;
revoke all on function public.join_public_channel(uuid) from public,anon;
grant execute on function app_private.create_channel(text,text,boolean) to authenticated;
grant execute on function app_private.can_access_channel_avatar(uuid) to authenticated;
grant execute on function public.create_channel(text,text,boolean) to authenticated;
grant execute on function public.discover_public_channels(text,integer,integer) to authenticated;
grant execute on function public.join_public_channel(uuid) to authenticated;