create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  notification_type text not null check (notification_type in ('message','mention','reply','group_invite','admin_change')),
  title text not null,
  body text not null default '',
  event_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, event_key)
);
create index if not exists user_notifications_recipient_created_idx on public.user_notifications (recipient_id, created_at desc);
create index if not exists user_notifications_unread_idx on public.user_notifications (recipient_id, created_at desc) where read_at is null;
alter table public.user_notifications enable row level security;
revoke all on table public.user_notifications from public, anon, authenticated;
grant select on table public.user_notifications to authenticated;
grant update (read_at) on table public.user_notifications to authenticated;
drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications" on public.user_notifications for select to authenticated using ((select auth.uid()) = recipient_id);
drop policy if exists "Users mark own notifications read" on public.user_notifications;
create policy "Users mark own notifications read" on public.user_notifications for update to authenticated using ((select auth.uid()) = recipient_id) with check ((select auth.uid()) = recipient_id);

create or replace function app_private.insert_user_notification(p_recipient_id uuid,p_actor_id uuid,p_conversation_id uuid,p_message_id uuid,p_type text,p_title text,p_body text,p_event_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient_id is null or p_actor_id is null or p_recipient_id = p_actor_id then return; end if;
  insert into public.user_notifications(recipient_id,actor_id,conversation_id,message_id,notification_type,title,body,event_key)
  values(p_recipient_id,p_actor_id,p_conversation_id,p_message_id,p_type,left(coalesce(p_title,''),120),left(coalesce(p_body,''),220),p_event_key)
  on conflict(recipient_id,event_key) do nothing;
end; $$;

create or replace function app_private.notify_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor_name text; v_conversation_title text; v_body text; v_parent_sender uuid;
  v_recipient record; v_mentioned boolean; v_type text; v_title text;
begin
  select coalesce(p.display_name,p.username,'عضو') into v_actor_name from public.profiles p where p.id=new.sender_id;
  select coalesce(c.title,case when c.type='direct' then 'محادثة خاصة' when c.type='channel' then 'قناة' else 'مجموعة' end)
    into v_conversation_title from public.conversations c where c.id=new.conversation_id;
  v_body:=left(coalesce(nullif(btrim(new.content),''),case when new.attachment_path is not null then 'أرسل مرفقاً' else 'رسالة جديدة' end),180);
  if new.reply_to is not null then
    select m.sender_id into v_parent_sender from public.chat_messages m
    where m.id=new.reply_to and m.conversation_id=new.conversation_id and m.deleted_at is null;
  end if;
  for v_recipient in select cm.user_id from public.conversation_members cm
    where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id
  loop
    select exists(
      select 1 from regexp_matches(coalesce(new.content,''),'@([A-Za-z0-9_]{3,24})','g') as mention(parts)
      join public.profiles p on lower(p.username)=lower(mention.parts[1])
      where p.id=v_recipient.user_id
    ) into v_mentioned;
    if v_mentioned then v_type:='mention';v_title:=v_actor_name||' أشار إليك';
    elsif v_parent_sender=v_recipient.user_id then v_type:='reply';v_title:=v_actor_name||' رد على رسالتك';
    else v_type:='message';v_title:='رسالة جديدة من '||v_actor_name;end if;
    perform app_private.insert_user_notification(v_recipient.user_id,new.sender_id,new.conversation_id,new.id,v_type,v_title,
      v_conversation_title||' · '||v_body,'message:'||new.id::text||':'||v_type);
  end loop;
  return new;
end; $$;

create or replace function app_private.notify_group_member_added()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid();v_type text;v_group_title text;v_actor_name text;
begin
  if v_actor is null or v_actor=new.user_id then return new;end if;
  select c.type,coalesce(c.title,'مجموعة جديدة') into v_type,v_group_title from public.conversations c where c.id=new.conversation_id;
  if v_type<>'group' then return new;end if;
  select coalesce(p.display_name,p.username,'مشرف') into v_actor_name from public.profiles p where p.id=v_actor;
  perform app_private.insert_user_notification(new.user_id,v_actor,new.conversation_id,null,'group_invite','تمت إضافتك إلى مجموعة',
    coalesce(v_actor_name,'مشرف')||' أضافك إلى مجموعة «'||v_group_title||'»',
    'group-invite:'||new.conversation_id::text||':'||new.user_id::text||':'||extract(epoch from coalesce(new.joined_at,now()))::text);
  return new;
end; $$;

create or replace function app_private.notify_membership_role_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid();v_group_title text;v_actor_name text;v_role_label text;
begin
  if new.role is not distinct from old.role or v_actor is null or v_actor=new.user_id then return new;end if;
  select coalesce(c.title,'المحادثة') into v_group_title from public.conversations c where c.id=new.conversation_id;
  select coalesce(p.display_name,p.username,'الإدارة') into v_actor_name from public.profiles p where p.id=v_actor;
  v_role_label:=case when new.role in ('owner','admin') then 'تم منحك صلاحية الإشراف' else 'تم تغيير صلاحية الإشراف الخاصة بك' end;
  perform app_private.insert_user_notification(new.user_id,v_actor,new.conversation_id,null,'admin_change',v_role_label,
    coalesce(v_actor_name,'الإدارة')||' حدّث صلاحيتك في «'||v_group_title||'»',
    'role-change:'||new.conversation_id::text||':'||new.user_id::text||':'||new.role||':'||extract(epoch from clock_timestamp())::text);
  return new;
end; $$;

drop trigger if exists chat_messages_notify_recipients on public.chat_messages;
create trigger chat_messages_notify_recipients after insert on public.chat_messages for each row execute function app_private.notify_chat_message();
drop trigger if exists conversation_members_notify_added on public.conversation_members;
create trigger conversation_members_notify_added after insert on public.conversation_members for each row execute function app_private.notify_group_member_added();
drop trigger if exists conversation_members_notify_role_change on public.conversation_members;
create trigger conversation_members_notify_role_change after update of role on public.conversation_members for each row execute function app_private.notify_membership_role_change();

revoke all on function app_private.insert_user_notification(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function app_private.notify_chat_message() from public,anon,authenticated;
revoke all on function app_private.notify_group_member_added() from public,anon,authenticated;
revoke all on function app_private.notify_membership_role_change() from public,anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;
alter table public.user_notifications replica identity full;
