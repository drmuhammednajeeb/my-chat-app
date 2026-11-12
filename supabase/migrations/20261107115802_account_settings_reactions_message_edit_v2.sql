-- Account-scoped JSONB settings, six message reactions, and secure 15-minute text edits.
-- Existing reaction rows (like/heart) and existing messages remain compatible.

-- 1) General account settings, separate from per-conversation preferences.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb
    constraint user_settings_settings_object check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "Users read own account settings" on public.user_settings;
create policy "Users read own account settings"
  on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users create own account settings" on public.user_settings;
create policy "Users create own account settings"
  on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own account settings" on public.user_settings;
create policy "Users update own account settings"
  on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_settings from public, anon;
grant select, insert, update on table public.user_settings to authenticated;

create or replace function public.patch_my_user_settings(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_settings jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings patch must be a JSON object';
  end if;
  if pg_column_size(p_patch) > 16384 then
    raise exception 'Settings patch is too large';
  end if;

  insert into public.user_settings (user_id, settings, updated_at)
  values (v_user_id, p_patch, clock_timestamp())
  on conflict (user_id) do update
    set settings = public.user_settings.settings || excluded.settings,
        updated_at = clock_timestamp()
  returning settings into v_settings;

  return v_settings;
end;
$function$;

revoke all on function public.patch_my_user_settings(jsonb) from public, anon;
grant execute on function public.patch_my_user_settings(jsonb) to authenticated;

-- 2) Expand the existing reaction allow-list without changing legacy values or its
-- composite primary key (message_id, user_id), which enforces one reaction per user/message.
alter table public.message_reactions
  drop constraint if exists message_reactions_reaction_type_check;
alter table public.message_reactions
  add constraint message_reactions_reaction_type_check
  check (reaction_type = any (array['like','heart','wow','pray','fire','celebrate']::text[]));

-- 3) Message edit revision counter and private audit history.
alter table public.chat_messages
  add column if not exists edit_revision integer not null default 0;
alter table public.chat_messages
  drop constraint if exists chat_messages_edit_revision_check;
alter table public.chat_messages
  add constraint chat_messages_edit_revision_check check (edit_revision >= 0);

create table if not exists public.message_edit_history (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  editor_id uuid not null references auth.users(id) on delete restrict,
  old_content text not null,
  new_content text not null,
  revision_number integer not null check (revision_number > 0),
  edited_at timestamptz not null default clock_timestamp(),
  constraint message_edit_history_message_revision_key unique (message_id, revision_number)
);

create index if not exists message_edit_history_message_revision_idx
  on public.message_edit_history (message_id, revision_number desc);

alter table public.message_edit_history enable row level security;
revoke all on table public.message_edit_history from public, anon, authenticated;
grant select on table public.message_edit_history to authenticated;

create or replace function app_private.can_view_message_edit_history(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.chat_messages m
      where m.id = p_message_id
        and (
          m.sender_id = (select auth.uid())
          or app_private.is_team_admin()
        )
    );
$function$;

revoke all on function app_private.can_view_message_edit_history(uuid) from public, anon;
grant execute on function app_private.can_view_message_edit_history(uuid) to authenticated;

drop policy if exists "Authors and authorized admins read edit history" on public.message_edit_history;
create policy "Authors and authorized admins read edit history"
  on public.message_edit_history for select to authenticated
  using (app_private.can_view_message_edit_history(message_id));

-- Direct client UPDATEs must not bypass the 15-minute rule or the audit log.
-- The existing soft-delete action remains supported.
create or replace function public.guard_chat_message_content_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if current_setting('app.allow_message_edit', true) = 'on' then
    return new;
  end if;

  if new.content is distinct from old.content
     or new.edited_at is distinct from old.edited_at
     or new.edit_revision is distinct from old.edit_revision then
    if old.deleted_at is null
       and new.deleted_at is not null
       and new.content = 'تم حذف الرسالة'
       and new.attachment_path is null
       and new.attachment_type is null
       and new.edited_at is not distinct from old.edited_at
       and new.edit_revision is not distinct from old.edit_revision then
      return new;
    end if;
    raise exception 'Message text can only be changed through the secure edit operation';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_chat_message_content_update on public.chat_messages;
create trigger guard_chat_message_content_update
before update on public.chat_messages
for each row execute function public.guard_chat_message_content_update();

-- Atomic edit operation: locks the row, checks ownership/membership/type/deadline/revision,
-- writes the history row, then updates the current message.
create or replace function public.edit_message_secure(
  p_message_id uuid,
  p_new_content text,
  p_expected_revision integer
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_message public.chat_messages;
  v_updated public.chat_messages;
  v_conversation_type text;
  v_content text := btrim(coalesce(p_new_content, ''));
  v_next_revision integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_message_id is null then
    raise exception 'Message ID is required';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 5000 then
    raise exception 'Message text must contain between 1 and 5000 characters';
  end if;

  select * into v_message
  from public.chat_messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'Message not found';
  end if;
  if v_message.sender_id <> v_user_id then
    raise exception 'You can only edit your own messages';
  end if;
  if not app_private.is_conversation_member(v_message.conversation_id) then
    raise exception 'You are not a member of this conversation';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'Deleted messages cannot be edited';
  end if;
  if v_message.attachment_path is not null or v_message.attachment_type is not null then
    raise exception 'Only text-only messages can be edited';
  end if;

  select c.type into v_conversation_type
  from public.conversations c
  where c.id = v_message.conversation_id;
  if v_conversation_type not in ('direct', 'group') then
    raise exception 'Editing is available only in direct and group conversations';
  end if;

  if clock_timestamp() > v_message.created_at + interval '15 minutes' then
    raise exception 'The 15-minute edit window has expired';
  end if;

  if p_expected_revision is null
     or p_expected_revision <> coalesce(v_message.edit_revision, 0) then
    raise exception 'This message changed elsewhere. Refresh it before editing again';
  end if;

  if v_content = v_message.content then
    return v_message;
  end if;

  v_next_revision := coalesce(v_message.edit_revision, 0) + 1;
  insert into public.message_edit_history (
    message_id, editor_id, old_content, new_content, revision_number, edited_at
  ) values (
    v_message.id, v_user_id, v_message.content, v_content, v_next_revision, clock_timestamp()
  );

  perform set_config('app.allow_message_edit', 'on', true);
  update public.chat_messages
  set content = v_content,
      edited_at = clock_timestamp(),
      edit_revision = v_next_revision
  where id = v_message.id
  returning * into v_updated;

  return v_updated;
end;
$function$;

revoke all on function public.edit_message_secure(uuid, text, integer) from public, anon;
grant execute on function public.edit_message_secure(uuid, text, integer) to authenticated;

comment on table public.message_edit_history is
  'Private message edit audit history. Readable only by the message author and authorized team administrators.';
comment on table public.user_settings is
  'Per-account JSONB settings; distinct from per-conversation user_chat_preferences.';
