-- Correct profile status validation to allow text-only, media-only, and combined updates.
-- Preserve ownership, media-type, path-extension, expiry, and active-member protections.
begin;

alter table public.profile_statuses
  drop constraint if exists profile_statuses_content_or_image_check;

alter table public.profile_statuses
  add constraint profile_statuses_content_or_image_check
  check (
    (content is null or char_length(btrim(content)) between 1 and 280)
    and (image_path is null or media_type in ('image', 'video'))
    and (image_path is not null or media_type is null)
    and (content is not null or image_path is not null)
  );

-- Use a single escaped dot in the PostgreSQL regex. The previous pattern
-- contained two backslashes and rejected valid UUID-based object paths.
alter table public.profile_statuses
  drop constraint if exists profile_statuses_image_path_check;

alter table public.profile_statuses
  add constraint profile_statuses_image_path_check
  check (
    image_path is null
    or (
      image_path ~ (
        '^' || user_id::text || '/[0-9a-fA-F-]{36}\.(jpg|png|webp|mp4|webm|mov)$'
      )
      and case media_type
        when 'image' then image_path ~* '\.(jpg|png|webp)$'
        when 'video' then image_path ~* '\.(mp4|webm|mov)$'
        else false
      end
    )
  );

drop policy if exists "Users create own profile statuses" on public.profile_statuses;
create policy "Users create own profile statuses"
on public.profile_statuses
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and expires_at > now()
  and (content is not null or image_path is not null)
  and (select app_private.is_active_member())
);

commit;
