-- Forward reconciliation migration for an existing production Storage configuration
-- that is present in the live catalog but absent from the recorded migration ledger.
-- This preserves the browser-recorded audio formats already enabled on chat-media.
-- The UPDATE is idempotent and leaves bucket visibility and size limit unchanged.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac'
]::text[]
WHERE id = 'chat-media';
