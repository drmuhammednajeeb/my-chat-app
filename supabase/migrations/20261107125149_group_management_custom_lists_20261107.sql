
create table if not exists public.conversation_group_settings (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  only_admins_can_send boolean not null default false,
  disappearing_seconds integer not null default 0 check (disappearing_seconds in (0, 86400, 604800, 2592000)),
  theme_color text not null default 'default' check (theme_color in ('default','emerald','blue','violet','amber','rose')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.conversation_group_settings enable row level security;
grant select, insert, update on public.conversation_group_settings to authenticated;
drop policy if exists "Members read group settings" on public.conversation_group_settings;
create policy "Members read group settings" on public.conversation_group_settings for select to authenticated
using (app_private.is_conversation_member(conversation_id));
drop policy if exists "Group admins manage settings" on public.conversation_group_settings;
create policy "Group admins manage settings" on public.conversation_group_settings for all to authenticated
using (app_private.can_manage_conversation(conversation_id))
with check (app_private.can_manage_conversation(conversation_id));

create table if not exists public.conversation_member_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('joined','left','removed','promoted','demoted')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conversation_member_events_conversation_created_idx
  on public.conversation_member_events(conversation_id, created_at desc);
alter table public.conversation_member_events enable row level security;
grant select on public.conversation_member_events to authenticated;
drop policy if exists "Members read membership history" on public.conversation_member_events;
create policy "Members read membership history" on public.conversation_member_events for select to authenticated
using (app_private.is_conversation_member(conversation_id));

create table if not exists public.user_message_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,message_id),
  constraint user_message_stars_membership_fk foreign key(conversation_id,user_id)
    references public.conversation_members(conversation_id,user_id) on delete cascade
);
create index if not exists user_message_stars_user_conversation_idx
  on public.user_message_stars(user_id,conversation_id,created_at desc);
alter table public.user_message_stars enable row level security;
grant select,insert,delete on public.user_message_stars to authenticated;
drop policy if exists "Users manage their own starred messages" on public.user_message_stars;
create policy "Users manage their own starred messages" on public.user_message_stars for all to authenticated
using (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id))
with check (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id)
  and exists(select 1 from public.chat_messages m where m.id=message_id and m.conversation_id=user_message_stars.conversation_id and m.deleted_at is null));

create table if not exists public.user_conversation_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  is_muted boolean not null default false,
  notification_tone text not null default 'default' check (notification_tone in ('default','soft','bell','chime','silent')),
  updated_at timestamptz not null default now(),
  primary key(user_id,conversation_id),
  constraint user_conversation_settings_membership_fk foreign key(conversation_id,user_id)
    references public.conversation_members(conversation_id,user_id) on delete cascade
);
alter table public.user_conversation_settings enable row level security;
grant select,insert,update,delete on public.user_conversation_settings to authenticated;
drop policy if exists "Users manage their own conversation settings" on public.user_conversation_settings;
create policy "Users manage their own conversation settings" on public.user_conversation_settings for all to authenticated
using (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id))
with check (user_id=(select auth.uid()) and app_private.is_conversation_member(conversation_id));

create table if not exists public.chat_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,name),
  unique(id,user_id)
);
alter table public.chat_lists enable row level security;
grant select,insert,update,delete on public.chat_lists to authenticated;
drop policy if exists "Users manage their own chat lists" on public.chat_lists;
create policy "Users manage their own chat lists" on public.chat_lists for all to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create table if not exists public.chat_list_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,list_id,conversation_id),
  foreign key(list_id,user_id) references public.chat_lists(id,user_id) on delete cascade,
  foreign key(conversation_id,user_id) references public.conversation_members(conversation_id,user_id) on delete cascade
);
create index if not exists chat_list_items_user_conversation_idx
  on public.chat_list_items(user_id,conversation_id);
alter table public.chat_list_items enable row level security;
grant select,insert,delete on public.chat_list_items to authenticated;
drop policy if exists "Users manage their own chat list items" on public.chat_list_items;
create policy "Users manage their own chat list items" on public.chat_list_items for all to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

alter table public.user_chat_preferences
  add column if not exists is_favorite boolean not null default false;

alter table public.chat_messages
  add column if not exists expires_at timestamptz;
create index if not exists chat_messages_expiry_idx on public.chat_messages(expires_at) where expires_at is not null;

create or replace function app_private.prepare_group_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seconds integer;
begin
  select s.disappearing_seconds into v_seconds
  from public.conversation_group_settings s
  join public.conversations c on c.id=s.conversation_id
  where s.conversation_id=new.conversation_id and c.type='group';
  if coalesce(v_seconds,0)>0 then
    new.expires_at := now() + make_interval(secs => v_seconds);
  end if;
  return new;
end;
$$;
revoke all on function app_private.prepare_group_message_expiry() from public, anon, authenticated;
drop trigger if exists prepare_group_message_expiry on public.chat_messages;
create trigger prepare_group_message_expiry before insert on public.chat_messages
for each row execute function app_private.prepare_group_message_expiry();

create or replace function app_private.ensure_group_settings_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type='group' then
    insert into public.conversation_group_settings(conversation_id) values(new.id)
    on conflict(conversation_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app_private.ensure_group_settings_row() from public, anon, authenticated;
drop trigger if exists ensure_group_settings_row on public.conversations;
create trigger ensure_group_settings_row after insert on public.conversations
for each row execute function app_private.ensure_group_settings_row();

insert into public.conversation_group_settings(conversation_id)
select id from public.conversations where type='group'
on conflict(conversation_id) do nothing;

create or replace function app_private.log_conversation_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_event text;
  v_target uuid;
  v_details jsonb := '{}'::jsonb;
begin
  if tg_op='INSERT' then
    v_event := 'joined'; v_target := new.user_id;
    v_details := jsonb_build_object('role',new.role);
    insert into public.conversation_member_events(conversation_id,actor_id,target_user_id,event_type,details)
    values(new.conversation_id,v_actor,v_target,v_event,v_details);
    return new;
  elsif tg_op='DELETE' then
    v_target := old.user_id;
    v_event := case when v_actor=old.user_id then 'left' else 'removed' end;
    v_details := jsonb_build_object('previous_role',old.role);
    insert into public.conversation_member_events(conversation_id,actor_id,target_user_id,event_type,details)
    values(old.conversation_id,v_actor,v_target,v_event,v_details);
    return old;
  elsif old.role is distinct from new.role then
    v_target := new.user_id;
    v_event := case when new.role in ('admin','owner') then 'promoted' else 'demoted' end;
    v_details := jsonb_build_object('old_role',old.role,'new_role',new.role);
    insert into public.conversation_member_events(conversation_id,actor_id,target_user_id,event_type,details)
    values(new.conversation_id,v_actor,v_target,v_event,v_details);
  end if;
  return new;
end;
$$;
revoke all on function app_private.log_conversation_membership_change() from public, anon, authenticated;
drop trigger if exists log_conversation_membership_change on public.conversation_members;
create trigger log_conversation_membership_change after insert or update of role or delete on public.conversation_members
for each row execute function app_private.log_conversation_membership_change();

create or replace function app_private.guard_group_member_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role is distinct from new.role then
    if not app_private.can_manage_conversation(old.conversation_id) then
      raise exception 'Only group administrators can change member roles' using errcode='42501';
    end if;
    if old.role='owner' and not app_private.is_team_admin() then
      raise exception 'The group owner role cannot be changed here' using errcode='42501';
    end if;
    if new.role='owner' and not app_private.is_team_admin() then
      raise exception 'Only an authorized team administrator can assign ownership' using errcode='42501';
    end if;
  end if;
  if old.user_id is distinct from new.user_id or old.conversation_id is distinct from new.conversation_id then
    raise exception 'Membership identity cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_group_member_role_change() from public, anon, authenticated;
drop trigger if exists guard_group_member_role_change on public.conversation_members;
create trigger guard_group_member_role_change before update on public.conversation_members
for each row execute function app_private.guard_group_member_role_change();

drop policy if exists "Members send as themselves" on public.chat_messages;
create policy "Members send as themselves" on public.chat_messages for insert to authenticated
with check (
 sender_id=(select auth.uid())
 and app_private.is_conversation_member(conversation_id)
 and (
   not exists(select 1 from public.conversations c where c.id=chat_messages.conversation_id and c.type='channel')
   or app_private.can_manage_conversation(conversation_id)
 )
 and (
   not exists(select 1 from public.conversations c join public.conversation_group_settings gs on gs.conversation_id=c.id
     where c.id=chat_messages.conversation_id and c.type='group' and gs.only_admins_can_send)
   or app_private.can_manage_conversation(conversation_id)
 )
 and (
   reply_to is null or exists(select 1 from public.chat_messages parent
     where parent.id=chat_messages.reply_to and parent.conversation_id=chat_messages.conversation_id and parent.deleted_at is null)
 )
);

drop policy if exists "Owners update conversations" on public.conversations;
create policy "Owners update conversations" on public.conversations for update to authenticated
using (created_by=(select auth.uid()) or app_private.can_manage_conversation(id))
with check (created_by=(select auth.uid()) or app_private.can_manage_conversation(id));

drop policy if exists "Members update own read state" on public.conversation_members;
create policy "Members update own read state" on public.conversation_members for update to authenticated
using (user_id=(select auth.uid()) or app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()))
with check (user_id=(select auth.uid()) or app_private.can_manage_conversation(conversation_id) or (select app_private.is_team_admin()));

comment on table public.chat_lists is 'Personal user-defined conversation categories; membership is private to the owner.';
comment on table public.chat_list_items is 'Personal assignments of conversations to one or more custom lists.';
comment on table public.conversation_member_events is 'Append-only membership and administrator change history.';
