-- TEST ONLY. The repository does not create these two buckets although the browser client uses them.
-- These private bucket definitions exist only for the disposable local replay.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'chat-media', 'chat-media', false, 12582912,
    array[
      'image/jpeg','image/png','image/webp','image/gif','application/pdf',
      'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/aac'
    ]::text[]
  ),
  (
    'conversation-documents', 'conversation-documents', false, 26214400,
    array['application/pdf','image/jpeg','image/png','image/webp']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
