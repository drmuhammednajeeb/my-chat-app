-- Extend the existing private profile-status media bucket to support short videos.
-- Existing status rows and image paths remain compatible; no chat-message tables are changed.
begin;

alter table public.profile_statuses
  add column if not exists media_type text;

update public.profile_statuses
set media_type = 'image'
where image_path is not null and media_type is null;

alter table public.profile_statuses
  drop constraint if exists profile_statuses_content_or_image_check;

alter table public.profile_statuses
  add constraint profile_statuses_content_or_image_check
  check (
    (
      content is not null
      and image_path is null
      and media_type is null
      and char_length(btrim(content)) between 1 and 280
    )
    or
    (
      content is null
      and image_path is not null
      and media_type is not null
      and media_type in ('image', 'video')
    )
  );

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

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ]
where id = 'profile-status-media';

commit;
