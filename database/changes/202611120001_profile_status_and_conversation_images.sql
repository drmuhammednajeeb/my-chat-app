-- Profile statuses (24-hour visibility) and private group/channel images.
-- Source-only migration: do not apply to production without the normal release approval.

begin;

create table if not exists public.profile_statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  image_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint profile_statuses_content_or_image_check check (
    (content is not null and image_path is null and char_length(btrim(content)) between 1 and 280)
    or
    (content is null and image_path is not null)
  ),
  constraint profile_statuses_image_path_check check (
    image_path is null or image_path ~ (
      '^' || user_id::text || '/[0-9a-fA-F-]{36}\\.(jpg|png|webp)$'
    )
  )
);

create index if not exists profile_statuses_user_created_idx
  on public.profile_statuses(user_id, created_at desc);

create index if not exists profile_statuses_active_expiry_idx
  on public.profile_statuses(expires_at);

create or replace function app_private.enforce_profile_status_24h()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.expires_at := new.created_at + interval '24 hours';
  return new;
end;
$$;

revoke all on function app_private.enforce_profile_status_24h() from public, anon, authenticated;

drop trigger if exists profile_statuses_enforce_24h on public.profile_statuses;
create trigger profile_statuses_enforce_24h
before insert or update on public.profile_statuses
for each row execute function app_private.enforce_profile_status_24h();

alter table public.profile_statuses enable row level security;

drop policy if exists "Authenticated users read active profile statuses" on public.profile_statuses;
create policy "Authenticated users read active profile statuses"
on public.profile_statuses for select to authenticated
using (expires_at > now());

drop policy if exists "Users create own profile statuses" on public.profile_statuses;
create policy "Users create own profile statuses"
on public.profile_statuses for insert to authenticated
with check (
  user_id = (select auth.uid())
  and expires_at > now()
  and (
    (content is not null and image_path is null)
    or (content is null and image_path is not null)
  )
);

drop policy if exists "Users delete own profile statuses" on public.profile_statuses;
create policy "Users delete own profile statuses"
on public.profile_statuses for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on public.profile_statuses from public, anon;
grant select, insert, delete on public.profile_statuses to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-status-media', 'profile-status-media', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own profile status media" on storage.objects;
create policy "Users upload own profile status media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-status-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Read active profile status media" on storage.objects;
create policy "Read active profile status media"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-status-media'
  and exists (
    select 1
    from public.profile_statuses s
    where s.image_path = storage.objects.name
      and s.user_id::text = (storage.foldername(storage.objects.name))[1]
      and s.expires_at > now()
  )
);

drop policy if exists "Users delete own profile status media" on storage.objects;
create policy "Users delete own profile status media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-status-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter table public.conversations
  add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversation-avatars', 'conversation-avatars', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Conversation managers upload conversation avatars" on storage.objects;
create policy "Conversation managers upload conversation avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'conversation-avatars'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Conversation members read conversation avatars" on storage.objects;
create policy "Conversation members read conversation avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'conversation-avatars'
  and (
    app_private.is_conversation_member(((storage.foldername(name))[1])::uuid)
    or exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[1])::uuid
        and c.type = 'channel'
        and c.is_public = true
    )
  )
);

drop policy if exists "Conversation managers delete conversation avatars" on storage.objects;
create policy "Conversation managers delete conversation avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'conversation-avatars'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and app_private.can_manage_conversation(((storage.foldername(name))[1])::uuid)
);

create or replace function public.set_conversation_image(
  p_conversation_id uuid,
  p_image_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  expected_prefix text;
begin
  if actor is null then
    raise exception 'يجب تسجيل الدخول لتغيير صورة المحادثة' using errcode = '28000';
  end if;
  if not app_private.can_manage_conversation(p_conversation_id) then
    raise exception 'تغيير الصورة متاح لمالك المحادثة أو مشرفها فقط' using errcode = '42501';
  end if;

  if p_image_path is not null then
    expected_prefix := p_conversation_id::text || '/' || actor::text || '/';
    if left(p_image_path, length(expected_prefix)) <> expected_prefix
       or p_image_path !~* '\\.(jpg|png|webp)$'
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'conversation-avatars'
           and o.name = p_image_path
       ) then
      raise exception 'مسار صورة المحادثة غير صالح' using errcode = '22023';
    end if;
  end if;

  update public.conversations
  set image_path = p_image_path,
      updated_at = now()
  where id = p_conversation_id
    and type in ('group','channel');

  if not found then
    raise exception 'المجموعة أو القناة غير موجودة' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_conversation_image(uuid,text) from public, anon;
grant execute on function public.set_conversation_image(uuid,text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profile_statuses'
  ) then
    return;
  end if;
  alter publication supabase_realtime add table public.profile_statuses;
end
$$;

commit;
