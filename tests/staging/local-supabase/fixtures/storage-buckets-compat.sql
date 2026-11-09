-- TEST ONLY. The browser uses chat-media, but repository SQL does not create it.
-- conversation-documents is created by the workspace SQL and is intentionally not stubbed here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 12582912,
  array[
    'image/jpeg','image/png','image/webp','image/gif','application/pdf',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/aac'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
