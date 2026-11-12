-- Reconstructed prerequisite baseline: team administration and group capacity.
-- No real administrator identity is seeded by this migration.
-- Ultra Chat Pro: Team management dashboard and 200-member group capacity.
-- Administrator assignment is a separate controlled operational step.
begin;

create table if not exists app_private.team_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_private.team_admins enable row level security;
revoke all on app_private.team_admins from public, anon, authenticated;



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
      ) order by coalesce(g.last_message_at,g.created_at) desc)
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

-- Professional message controls and receipt base.
-- Professional chat: reply integrity, pins, delivery receipts.
alter table public.conversation_members
  add column if not exists last_delivered_at timestamptz;

create table public.message_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);
create index message_pins_conversation_pinned_at_idx on public.message_pins(conversation_id, pinned_at desc);
create index message_pins_message_idx on public.message_pins(message_id);
alter table public.message_pins enable row level security;
alter table public.message_pins replica identity full;
grant select, insert, delete on public.message_pins to authenticated;

create policy "Conversation members read pinned messages"
on public.message_pins for select to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_pins.message_id
      and m.conversation_id = message_pins.conversation_id
      and m.deleted_at is null
  )
);
create policy "Members pin messages in their conversations"
on public.message_pins for insert to authenticated
with check (
  pinned_by = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_pins.message_id
      and m.conversation_id = message_pins.conversation_id
      and m.deleted_at is null
  )
);
create policy "Owners remove pins or members remove their own"
on public.message_pins for delete to authenticated
using (
  app_private.is_conversation_member(conversation_id)
  and (
    pinned_by = (select auth.uid())
    or app_private.can_manage_conversation(conversation_id)
    or (select app_private.is_team_admin())
  )
);

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves"
on public.chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (
    not exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id and c.type = 'channel'
    )
    or app_private.can_manage_conversation(conversation_id)
  )
  and (
    reply_to is null
    or exists (
      select 1 from public.chat_messages parent
      where parent.id = chat_messages.reply_to
        and parent.conversation_id = chat_messages.conversation_id
        and parent.deleted_at is null
    )
  )
);

drop policy if exists "Authors edit own messages" on public.chat_messages;
create policy "Authors edit own messages"
on public.chat_messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
)
with check (
  sender_id = (select auth.uid())
  and app_private.is_conversation_member(conversation_id)
  and (
    reply_to is null
    or exists (
      select 1 from public.chat_messages parent
      where parent.id = chat_messages.reply_to
        and parent.conversation_id = chat_messages.conversation_id
        and parent.deleted_at is null
    )
  )
);

alter publication supabase_realtime add table public.message_pins;

commit;
