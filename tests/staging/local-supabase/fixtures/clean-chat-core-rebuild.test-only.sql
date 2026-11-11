-- TEST-ONLY destructive rebuild. The runtime runner must target loopback PostgreSQL
-- and set app.test_only_local_replay=enabled. Never promote this file as a migration.
DO $guard$
BEGIN
  IF current_setting('app.test_only_local_replay', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'Refusing clean-chat-core fixture outside disposable local replay';
  END IF;
END
$guard$;

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '15s';

-- Old conversation/message data is explicitly disposable. Preserve Auth identities
-- and profiles; reset conversations and every FK-dependent conversation dataset.
TRUNCATE TABLE public.conversations CASCADE;

-- Storage objects are removed through the local Storage API by clean-chat-core-runtime.mjs.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS direct_user_low uuid,
  ADD COLUMN IF NOT EXISTS direct_user_high uuid;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_direct_pair_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_direct_pair_check
  CHECK (
    (type = 'direct'
      AND direct_user_low IS NOT NULL
      AND direct_user_high IS NOT NULL
      AND direct_user_low < direct_user_high)
    OR
    (type <> 'direct'
      AND direct_user_low IS NULL
      AND direct_user_high IS NULL)
  );

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_direct_user_low_fkey;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_direct_user_low_fkey
  FOREIGN KEY (direct_user_low) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_direct_user_high_fkey;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_direct_user_high_fkey
  FOREIGN KEY (direct_user_high) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_unique_idx
  ON public.conversations (direct_user_low, direct_user_high)
  WHERE type = 'direct';

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_conversation_id_id_key;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_conversation_id_id_key
  UNIQUE (conversation_id, id);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_timeline_v2_idx
  ON public.chat_messages (conversation_id, created_at DESC, id DESC);

ALTER TABLE public.message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_conversation_message_v2_fkey;
ALTER TABLE public.message_reactions
  ADD CONSTRAINT message_reactions_conversation_message_v2_fkey
  FOREIGN KEY (conversation_id, message_id)
  REFERENCES public.chat_messages (conversation_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.user_message_stars
  DROP CONSTRAINT IF EXISTS user_message_stars_conversation_message_v2_fkey;
ALTER TABLE public.user_message_stars
  ADD CONSTRAINT user_message_stars_conversation_message_v2_fkey
  FOREIGN KEY (conversation_id, message_id)
  REFERENCES public.chat_messages (conversation_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.message_pins
  DROP CONSTRAINT IF EXISTS message_pins_conversation_message_v2_fkey;
ALTER TABLE public.message_pins
  ADD CONSTRAINT message_pins_conversation_message_v2_fkey
  FOREIGN KEY (conversation_id, message_id)
  REFERENCES public.chat_messages (conversation_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.private_reply_contexts
  DROP CONSTRAINT IF EXISTS private_reply_contexts_direct_message_conversation_v2_fkey;
ALTER TABLE public.private_reply_contexts
  ADD CONSTRAINT private_reply_contexts_direct_message_conversation_v2_fkey
  FOREIGN KEY (direct_conversation_id, direct_message_id)
  REFERENCES public.chat_messages (conversation_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.private_reply_contexts
  DROP CONSTRAINT IF EXISTS private_reply_contexts_source_message_conversation_v2_fkey;
ALTER TABLE public.private_reply_contexts
  ADD CONSTRAINT private_reply_contexts_source_message_conversation_v2_fkey
  FOREIGN KEY (source_conversation_id, source_message_id)
  REFERENCES public.chat_messages (conversation_id, id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION app_private.get_or_create_direct_conversation_impl(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_low uuid;
  v_high uuid;
  v_pair_key text;
  v_conversation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app_private.is_active_member() THEN
    RAISE EXCEPTION 'Active verified membership required' USING ERRCODE = '42501';
  END IF;

  IF p_other_user_id IS NULL OR p_other_user_id = v_user_id THEN
    RAISE EXCEPTION 'A different user must be selected' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_other_user_id
      AND p.membership_status = 'active'
      AND p.membership_number_verified IS TRUE
      AND p.membership_number ~ '^971[0-9]{9}$'
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Target user is not eligible for direct chat' USING ERRCODE = '42501';
  END IF;

  v_low := LEAST(v_user_id, p_other_user_id);
  v_high := GREATEST(v_user_id, p_other_user_id);
  v_pair_key := v_low::text || ':' || v_high::text;

  -- Serialize both request directions; the unique partial index is the final
  -- database-level invariant even if a caller bypasses this lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_pair_key, 0));

  INSERT INTO public.conversations (
    type, title, created_by, direct_user_low, direct_user_high
  )
  VALUES ('direct', NULL, v_user_id, v_low, v_high)
  ON CONFLICT (direct_user_low, direct_user_high) WHERE type = 'direct'
  DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT c.id INTO v_conversation_id
    FROM public.conversations c
    WHERE c.type = 'direct'
      AND c.direct_user_low = v_low
      AND c.direct_user_high = v_high
    LIMIT 1;
  END IF;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Could not initialize direct conversation';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES
    (v_conversation_id, v_user_id, 'owner'),
    (v_conversation_id, p_other_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;

COMMIT;

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'conversations_direct_pair_unique_idx'
  ) THEN
    RAISE EXCEPTION 'Direct-pair unique index was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.message_reactions'::regclass
      AND conname = 'message_reactions_conversation_message_v2_fkey'
  ) THEN
    RAISE EXCEPTION 'Reaction composite conversation/message FK was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_message_stars'::regclass
      AND conname = 'user_message_stars_conversation_message_v2_fkey'
  ) THEN
    RAISE EXCEPTION 'Star composite conversation/message FK was not created';
  END IF;

END
$assert$;
