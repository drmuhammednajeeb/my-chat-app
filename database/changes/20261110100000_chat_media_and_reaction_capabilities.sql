-- Restore the complete set of media types exposed by the chat composer.
-- Also align the database reaction constraint with the six reaction options rendered by the client.
-- This migration is replayed only in the disposable local Supabase verification workflow until separately approved.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv'
]::text[]
where id = 'chat-media';

alter table public.message_reactions
  drop constraint if exists message_reactions_reaction_type_check;

alter table public.message_reactions
  add constraint message_reactions_reaction_type_check
  check (reaction_type in ('like', 'heart', 'wow', 'pray', 'fire', 'celebrate'));
