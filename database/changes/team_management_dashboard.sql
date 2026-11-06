
-- Ultra Chat Pro: Team management dashboard and 200-member group capacity.
-- Admin identity is seeded from the verified application owner account.
begin;

create table if not exists app_private.team_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_private.team_admins enable row level security;
revoke all on app_private.team_admins from public, anon, authenticated;

insert into app_private.team_admins(user_id)
select id from auth.users
where lower(email)=lower('drmuhammed.najeeb2020@gmail.com')
on conflict (user_id) do nothing;

create policy "Deny direct team admin table access"
on app_private.team_admins for all to authenticated
using (false) with check (false);

create or replace function app_private.is_team_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app_private.team_admins a
    where a.user_id = (select auth.uid())
  );
$$;
revoke all on function app_private.is_team_admin() from public, anon;
grant execute on function app_private.is_team_admin() to authenticated;

drop policy if exists "Members can view conversations" on public.conversations;
create policy "Members can view conversations"
on public.conversations for select to authenticated
using (
  app_private.is_conversation_member(id)
  or (type = 'channel' and is_public = true)
  or (select app_private.is_team_admin())
);

drop policy if exists "Members view membership" on public.conversation_members;
create policy "Members view membership"
on public.conversation_members for select to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  or (select app_private.is_team_admin())
);

drop policy if exists "Creator adds first member" on public.conversation_members;
create policy "Creator adds first member"
on public.conversation_members for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and role = 'owner'
    and app_private.is_conversation_creator(conversation_id)
  )
  or (
    role = 'member'
    and app_private.can_manage_conversation(conversation_id)
  )
  or (
    user_id = (select auth.uid())
    and role = 'member'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.type = 'channel' and c.is_public = true
    )
  )
  or (select app_private.is_team_admin())
);

drop policy if exists "Members update own read state" on public.conversation_members;
create policy "Members update own read state"
on public.conversation_members for update to authenticated
using (user_id = (select auth.uid()) or (select app_private.is_team_admin()))
with check (user_id = (select auth.uid()) or (select app_private.is_team_admin()));

drop policy if exists "Members leave or admins remove" on public.conversation_members;
create policy "Members leave or admins remove"
on public.conversation_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or app_private.can_manage_conversation(conversation_id)
  or (select app_private.is_team_admin())
);

create or replace function app_private.enforce_group_member_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_type text; current_members integer;
begin
  if tg_op = 'UPDATE'
     and new.conversation_id = old.conversation_id
     and new.user_id = old.user_id then
    return new;
  end if;

  select c.type into target_type
  from public.conversations c where c.id = new.conversation_id for update;

  if target_type = 'group' then
    select count(*) into current_members
    from public.conversation_members m
    where m.conversation_id = new.conversation_id;

    if current_members >= 200 then
      raise exception 'وصلت المجموعة إلى الحد الأقصى وهو 200 عضو'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_group_member_limit on public.conversation_members;
create trigger enforce_group_member_limit
before insert or update of conversation_id, user_id
on public.conversation_members
for each row execute function app_private.enforce_group_member_limit();

create or replace function app_private.get_team_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not app_private.is_team_admin() then
    raise exception 'غير مصرح لك بعرض لوحة إدارة الفريق' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'registered_count', (select count(*) from auth.users),
    'profile_count', (select count(*) from public.profiles),
    'active_7d', (
      select count(distinct m.sender_id)::integer
      from public.chat_messages m where m.created_at >= now() - interval '7 days'
    ),
    'inactive_7d', greatest(
      (select count(*) from auth.users) - (
        select count(distinct m.sender_id) from public.chat_messages m
        where m.created_at >= now() - interval '7 days'
      ), 0
    ),
    'messages_total', (select count(*) from public.chat_messages),
    'messages_7d', (select count(*) from public.chat_messages where created_at >= now() - interval '7 days'),
    'messages_30d', (select count(*) from public.chat_messages where created_at >= now() - interval '30 days'),
    'groups_count', (select count(*) from public.conversations where type = 'group'),
    'channels_count', (select count(*) from public.conversations where type = 'channel'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'created_at', g.created_at,
        'member_count', (select count(*) from public.conversation_members cm where cm.conversation_id = g.id),
        'last_message_at', (select max(m.created_at) from public.chat_messages m where m.conversation_id = g.id)
      ) order by coalesce(g.last_message_at,g.created_at))
      from public.conversations g where g.type = 'group'
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name,
        'created_at', p.created_at,
        'last_active_at', (select max(m.created_at) from public.chat_messages m where m.sender_id = p.id),
        'group_count', (select count(*) from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id where cm.user_id=p.id and c.type='group')
      ) order by p.created_at desc)
      from public.profiles p
    ), '[]'::jsonb),
    'daily_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day::date,
        'count', (select count(*) from public.chat_messages m where m.created_at >= d.day and m.created_at < d.day + interval '1 day')
      ) order by d.day)
      from generate_series(date_trunc('day',now())-interval '6 days',date_trunc('day',now()),interval '1 day') as d(day)
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function app_private.get_team_dashboard_stats() from public, anon;
grant execute on function app_private.get_team_dashboard_stats() to authenticated;

create or replace function public.get_team_dashboard_stats()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app_private.get_team_dashboard_stats(); $$;
revoke all on function public.get_team_dashboard_stats() from public, anon;
grant execute on function public.get_team_dashboard_stats() to authenticated;

commit;
