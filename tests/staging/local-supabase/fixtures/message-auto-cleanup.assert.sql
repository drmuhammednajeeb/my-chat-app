-- Disposable-local postconditions for the 100-hour message/media cleanup migration.
DO $assert$
DECLARE
  v_reply_delete_action "char";
  v_notification_delete_action "char";
  v_purge_definition text;
  v_claim_acl boolean;
  v_queue_rls boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations'
      AND column_name='is_official' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'conversations.is_official is missing or nullable';
  END IF;

  IF to_regclass('app_private.message_cleanup_queue') IS NULL THEN
    RAISE EXCEPTION 'private message cleanup queue is missing';
  END IF;

  SELECT c.confdeltype INTO v_reply_delete_action
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.chat_messages'::regclass
    AND c.conname='chat_messages_reply_to_fkey';

  IF v_reply_delete_action <> 'n' THEN
    RAISE EXCEPTION 'reply_to must remain SET NULL to preserve separately authored newer replies';
  END IF;

  SELECT c.confdeltype INTO v_notification_delete_action
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.user_notifications'::regclass
    AND c.conname='user_notifications_message_id_fkey';

  IF v_notification_delete_action <> 'c' THEN
    RAISE EXCEPTION 'message notifications must cascade with their parent message';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.message_reactions'::regclass
      AND conname='message_reactions_message_id_fkey'
      AND confdeltype='c'
  ) THEN
    RAISE EXCEPTION 'message reaction cascade is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.contype='f'
      AND c.confrelid='public.chat_messages'::regclass
      AND c.conname <> 'chat_messages_reply_to_fkey'
      AND c.confdeltype <> 'c'
  ) THEN
    RAISE EXCEPTION 'a child table referencing chat_messages does not cascade on delete';
  END IF;

  SELECT c.relrowsecurity INTO v_queue_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid='app_private.message_cleanup_queue'::regclass;

  IF NOT v_queue_rls THEN
    RAISE EXCEPTION 'private cleanup queue must have RLS enabled';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('app_private.purge_expired_chat_messages()'::regprocedure)
  INTO v_purge_definition;

  IF position('enqueue_expired_chat_messages' in v_purge_definition) = 0
     OR position('DELETE FROM PUBLIC.CHAT_MESSAGES' in upper(v_purge_definition)) > 0
     OR position('DELETE FROM STORAGE.OBJECTS' in upper(v_purge_definition)) > 0 THEN
    RAISE EXCEPTION 'legacy purge function still performs destructive SQL deletes';
  END IF;

  SELECT has_function_privilege('authenticated','public.claim_message_cleanup_batch(integer)','EXECUTE')
  INTO v_claim_acl;

  IF v_claim_acl THEN
    RAISE EXCEPTION 'authenticated must not execute the cleanup worker RPC';
  END IF;

  IF NOT has_function_privilege('service_role','public.claim_message_cleanup_batch(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute the cleanup worker RPC';
  END IF;
END;
$assert$;
