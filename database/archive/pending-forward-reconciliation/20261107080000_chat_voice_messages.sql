-- Enable common browser-recorded audio formats in the private chat-media bucket.
-- Existing conversation-membership RLS policies remain unchanged.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac'
]::text[]
where id = 'chat-media';
