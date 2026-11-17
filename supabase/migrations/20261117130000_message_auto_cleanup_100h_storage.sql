-- 100-hour chat retention with Storage API deletion, retries, pinned-message
-- protection, official-channel exemption, and dependent-row cleanup.
-- Storage objects are never deleted through SQL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.is_official IS
  'Server-managed exemption from automatic message and media retention cleanup for official channels.';

CREATE TABLE IF NOT EXISTS app_private.message_cleanup_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_kind text NOT NULL CHECK (item_kind IN ('message', 'orphan')),
  message_id uuid NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  storage_path text NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'storage_deleted')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until timestamptz NULL,
  last_error text NULL,
  queued_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT message_cleanup_queue_item_shape CHECK (
    (item_kind = 'message' AND message_id IS NOT NULL AND storage_path IS NULL)
    OR
    (item_kind = 'orphan' AND message_id IS NULL AND storage_path IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS message_cleanup_queue_message_uidx
  ON app_private.message_cleanup_queue (message_id)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_cleanup_queue_storage_path_uidx
  ON app_private.message_cleanup_queue (storage_path)
  WHERE storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_cleanup_queue_claim_idx
  ON app_private.message_cleanup_queue (status, locked_until, queued_at, id);

ALTER TABLE app_private.message_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.message_cleanup_queue
  FROM PUBLIC, anon, authenticated, service_role;

-- Notifications contain message-derived text. Delete them with the message,
-- rather than retaining stale copies with a NULL message_id.
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_message_id_fkey;

ALTER TABLE public.user_notifications
  ADD CONSTRAINT user_notifications_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;

-- A reply is itself a separately authored message, not disposable child metadata.
-- Preserve newer/pinned replies when their older parent expires; the dedicated
-- private_reply_contexts rows and all other message metadata already cascade.
COMMENT ON CONSTRAINT chat_messages_reply_to_fkey ON public.chat_messages IS
  'SET NULL intentionally preserves separately authored newer replies when an older parent expires; reply-context metadata cascades.';

CREATE OR REPLACE FUNCTION app_private.guard_official_conversation_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
BEGIN
  IF NEW.is_official IS DISTINCT FROM OLD.is_official THEN
    IF session_user <> 'postgres' AND COALESCE(v_request_role, '') <> 'service_role' THEN
      RAISE EXCEPTION 'Official-channel retention status is server-managed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.is_official THEN
      IF EXISTS (
        SELECT 1
        FROM app_private.message_cleanup_queue q
        JOIN public.chat_messages m ON m.id = q.message_id
        WHERE q.item_kind = 'message'
          AND q.status IN ('processing', 'storage_deleted')
          AND m.conversation_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'Cannot mark a channel official while message cleanup is processing'
          USING ERRCODE = '55000';
      END IF;

      DELETE FROM app_private.message_cleanup_queue q
      USING public.chat_messages m
      WHERE q.message_id = m.id
        AND q.item_kind = 'message'
        AND q.status = 'pending'
        AND m.conversation_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.guard_official_conversation_flag()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_official_conversation_flag ON public.conversations;
CREATE TRIGGER guard_official_conversation_flag
BEFORE UPDATE OF is_official ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION app_private.guard_official_conversation_flag();

CREATE OR REPLACE FUNCTION app_private.prevent_message_update_while_cleanup_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app_private.message_cleanup_queue q
    WHERE q.item_kind = 'message'
      AND q.message_id = OLD.id
  ) AND (
    ROW(
      NEW.conversation_id, NEW.created_at,
      NEW.reply_to, NEW.attachment_path, NEW.attachment_type
    ) IS DISTINCT FROM ROW(
      OLD.conversation_id, OLD.created_at,
      OLD.reply_to, OLD.attachment_path, OLD.attachment_type
    )
    OR (
      NEW.content IS DISTINCT FROM OLD.content
      AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'Message is already queued for retention cleanup'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.prevent_message_update_while_cleanup_queued()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prevent_message_update_while_cleanup_queued ON public.chat_messages;
CREATE TRIGGER prevent_message_update_while_cleanup_queued
BEFORE UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_message_update_while_cleanup_queued();

CREATE OR REPLACE FUNCTION app_private.prevent_pin_while_cleanup_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app_private.message_cleanup_queue q
    WHERE q.item_kind = 'message'
      AND q.message_id = NEW.message_id
  ) THEN
    RAISE EXCEPTION 'Message has entered retention cleanup and can no longer be pinned'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.prevent_pin_while_cleanup_queued()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prevent_pin_while_cleanup_queued ON public.message_pins;
CREATE TRIGGER prevent_pin_while_cleanup_queued
BEFORE INSERT OR UPDATE OF message_id ON public.message_pins
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_pin_while_cleanup_queued();

CREATE OR REPLACE FUNCTION app_private.enqueue_expired_chat_messages()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_message_count bigint := 0;
  v_orphan_count bigint := 0;
BEGIN
  INSERT INTO app_private.message_cleanup_queue (item_kind, message_id)
  SELECT 'message', m.id
  FROM public.chat_messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE (
      m.created_at < pg_catalog.clock_timestamp() - interval '100 hours'
      OR (m.expires_at IS NOT NULL AND m.expires_at <= pg_catalog.clock_timestamp())
    )
    AND NOT c.is_official
    AND NOT EXISTS (
      SELECT 1 FROM public.message_pins p WHERE p.message_id = m.id
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_message_count = ROW_COUNT;

  -- chat-media is dedicated to message attachments. This second pass safely
  -- queues abandoned/unreferenced objects only after the same 100-hour age.
  INSERT INTO app_private.message_cleanup_queue (item_kind, storage_path)
  SELECT 'orphan', o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'chat-media'
    AND o.created_at < pg_catalog.clock_timestamp() - interval '100 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_messages m WHERE m.attachment_path = o.name
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;

  RETURN v_message_count + v_orphan_count;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.enqueue_expired_chat_messages()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing five-minute cron contract, but change its behavior:
-- enqueue eligible rows; never delete message rows before Storage API succeeds.
CREATE OR REPLACE FUNCTION app_private.purge_expired_chat_messages()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN app_private.enqueue_expired_chat_messages();
END;
$function$;

REVOKE ALL ON FUNCTION app_private.purge_expired_chat_messages()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.claim_message_cleanup_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (
  queue_id bigint,
  item_kind text,
  message_id uuid,
  attachment_path text,
  storage_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT q.id, q.item_kind, q.message_id, q.storage_path, q.status
    FROM app_private.message_cleanup_queue q
    LEFT JOIN public.chat_messages m ON m.id = q.message_id
    LEFT JOIN public.conversations c ON c.id = m.conversation_id
    WHERE (
        q.status IN ('pending', 'storage_deleted')
        OR (q.status = 'processing' AND q.locked_until <= pg_catalog.clock_timestamp())
      )
      AND (
        (
          q.item_kind = 'message'
          AND m.id IS NOT NULL
          AND c.id IS NOT NULL
          AND NOT c.is_official
          AND (
            m.created_at < pg_catalog.clock_timestamp() - interval '100 hours'
            OR (m.expires_at IS NOT NULL AND m.expires_at <= pg_catalog.clock_timestamp())
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.message_pins p WHERE p.message_id = m.id
          )
        )
        OR
        (
          q.item_kind = 'orphan'
          AND q.storage_path IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.chat_messages m2 WHERE m2.attachment_path = q.storage_path
          )
        )
      )
    ORDER BY q.queued_at, q.id
    FOR UPDATE OF q SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250)
  ),
  updated AS (
    UPDATE app_private.message_cleanup_queue q
    SET status = CASE WHEN candidates.status = 'storage_deleted' THEN 'storage_deleted' ELSE 'processing' END,
        attempts = CASE WHEN candidates.status = 'storage_deleted' THEN q.attempts ELSE q.attempts + 1 END,
        locked_until = CASE
          WHEN candidates.status = 'storage_deleted' THEN NULL
          ELSE pg_catalog.clock_timestamp() + interval '10 minutes'
        END,
        last_error = CASE WHEN candidates.status = 'storage_deleted' THEN q.last_error ELSE NULL END,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE q.id = candidates.id
    RETURNING q.id, q.item_kind, q.message_id, q.storage_path, q.status
  )
  SELECT
    updated.id,
    updated.item_kind,
    updated.message_id,
    CASE
      WHEN updated.item_kind = 'message' THEN m.attachment_path
      ELSE updated.storage_path
    END,
    updated.status = 'storage_deleted'
  FROM updated
  LEFT JOIN public.chat_messages m ON m.id = updated.message_id
  ORDER BY updated.id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.mark_message_cleanup_storage_deleted(p_queue_ids bigint[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated bigint;
BEGIN
  UPDATE app_private.message_cleanup_queue
  SET status = 'storage_deleted',
      locked_until = NULL,
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = ANY(COALESCE(p_queue_ids, ARRAY[]::bigint[]))
    AND status IN ('processing', 'storage_deleted');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.release_message_cleanup_batch(
  p_queue_ids bigint[],
  p_error text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated bigint;
BEGIN
  UPDATE app_private.message_cleanup_queue
  SET status = 'pending',
      locked_until = NULL,
      last_error = pg_catalog.left(COALESCE(p_error, 'Storage API deletion failed'), 500),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = ANY(COALESCE(p_queue_ids, ARRAY[]::bigint[]))
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.complete_message_cleanup_batch(p_queue_ids bigint[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_completed bigint := 0;
  v_messages_deleted bigint := 0;
  v_orphans_deleted bigint := 0;
BEGIN
  WITH ready AS MATERIALIZED (
    SELECT q.id, q.item_kind, q.message_id
    FROM app_private.message_cleanup_queue q
    WHERE q.id = ANY(COALESCE(p_queue_ids, ARRAY[]::bigint[]))
      AND q.status = 'storage_deleted'
    FOR UPDATE
  ),
  deleted_messages AS (
    DELETE FROM public.chat_messages m
    USING ready r, public.conversations c
    WHERE r.item_kind = 'message'
      AND m.id = r.message_id
      AND c.id = m.conversation_id
      AND NOT c.is_official
      AND (
        m.created_at < pg_catalog.clock_timestamp() - interval '100 hours'
        OR (m.expires_at IS NOT NULL AND m.expires_at <= pg_catalog.clock_timestamp())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.message_pins p WHERE p.message_id = m.id
      )
    RETURNING m.id
  ),
  deleted_orphans AS (
    DELETE FROM app_private.message_cleanup_queue q
    USING ready r
    WHERE q.id = r.id
      AND r.item_kind = 'orphan'
    RETURNING q.id
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM deleted_messages),
    (SELECT pg_catalog.count(*) FROM deleted_orphans)
  INTO v_messages_deleted, v_orphans_deleted;

  v_completed := v_messages_deleted + v_orphans_deleted;
  RETURN v_completed;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.claim_message_cleanup_batch(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.mark_message_cleanup_storage_deleted(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.release_message_cleanup_batch(bigint[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.complete_message_cleanup_batch(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;

-- The Edge Function verifies this per-project random token using its service-role
-- client. The token itself is generated per database and remains in Vault.
DO $token$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'message_cleanup_token'
  ) THEN
    PERFORM vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      'message_cleanup_token',
      'Internal authentication token for the message auto-cleanup Edge Function',
      NULL
    );
  END IF;
END;
$token$;

CREATE OR REPLACE FUNCTION public.verify_message_cleanup_token(p_candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    p_candidate IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets s
      WHERE s.name = 'message_cleanup_token'
        AND s.decrypted_secret = p_candidate
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.claim_message_cleanup_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (
  queue_id bigint,
  item_kind text,
  message_id uuid,
  attachment_path text,
  storage_deleted boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT * FROM app_private.claim_message_cleanup_batch(p_limit);
$function$;

CREATE OR REPLACE FUNCTION public.mark_message_cleanup_storage_deleted(p_queue_ids bigint[])
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT app_private.mark_message_cleanup_storage_deleted(p_queue_ids);
$function$;

CREATE OR REPLACE FUNCTION public.release_message_cleanup_batch(p_queue_ids bigint[], p_error text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT app_private.release_message_cleanup_batch(p_queue_ids, p_error);
$function$;

CREATE OR REPLACE FUNCTION public.complete_message_cleanup_batch(p_queue_ids bigint[])
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT app_private.complete_message_cleanup_batch(p_queue_ids);
$function$;

REVOKE ALL ON FUNCTION public.verify_message_cleanup_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_message_cleanup_batch(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_message_cleanup_storage_deleted(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_message_cleanup_batch(bigint[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_message_cleanup_batch(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.verify_message_cleanup_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_message_cleanup_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_message_cleanup_storage_deleted(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_message_cleanup_batch(bigint[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_message_cleanup_batch(bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION app_private.set_message_cleanup_vault_secret(
  p_name text,
  p_value text,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT s.id INTO v_secret_id
  FROM vault.secrets s
  WHERE s.name = p_name
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, p_description, NULL);
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_value, p_name, p_description, NULL);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.configure_message_auto_cleanup(
  p_project_url text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_project_url text := pg_catalog.rtrim(pg_catalog.btrim(p_project_url), '/');
  v_job_id bigint;
  v_old_job_id bigint;
  v_backend_key text;
BEGIN
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Auto-cleanup scheduling must be configured by the database owner'
      USING ERRCODE = '42501';
  END IF;

  IF v_project_url NOT IN (
      'https://lvkeohpuucuklagvwpnq.supabase.co',
      'http://127.0.0.1:54321',
      'http://kong:8000'
    ) THEN
    RAISE EXCEPTION 'Unexpected Supabase project URL for auto-cleanup'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.decrypted_secret INTO v_backend_key
  FROM vault.decrypted_secrets s
  WHERE s.name = 'message_cleanup_backend_key';
  IF v_backend_key IS NULL OR v_backend_key !~ '^sb_secret_[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Store the project default sb_secret_ key in Vault as message_cleanup_backend_key before enabling the worker'
      USING ERRCODE = '22023';
  END IF;

  PERFORM app_private.set_message_cleanup_vault_secret(
    'message_cleanup_project_url',
    v_project_url,
    'Project URL used by the scheduled message auto-cleanup worker'
  );


  FOR v_old_job_id IN
    SELECT j.jobid FROM cron.job j WHERE j.jobname = 'message-auto-cleanup-worker'
  LOOP
    PERFORM cron.unschedule(v_old_job_id);
  END LOOP;

  v_job_id := cron.schedule(
    'message-auto-cleanup-worker',
    '*/5 * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT s.decrypted_secret
          FROM vault.decrypted_secrets s
          WHERE s.name = 'message_cleanup_project_url'
        ) || '/functions/v1/message-auto-cleanup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT s.decrypted_secret
            FROM vault.decrypted_secrets s
            WHERE s.name = 'message_cleanup_backend_key'
          ),
          'x-auto-cleanup-token', (
            SELECT s.decrypted_secret
            FROM vault.decrypted_secrets s
            WHERE s.name = 'message_cleanup_token'
          )
        ),
        body := jsonb_build_object('triggered_at', pg_catalog.clock_timestamp())
      );
    $command$
  );

  RETURN v_job_id;
END;
$function$;

COMMENT ON FUNCTION app_private.configure_message_auto_cleanup(text) IS
  'Requires the project default sb_secret_ key to be pre-stored in Vault as message_cleanup_backend_key. The key is sent only through apikey to an Edge Function configured with auth: secret and verify_jwt=false.';

REVOKE ALL ON FUNCTION app_private.set_message_cleanup_vault_secret(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.configure_message_auto_cleanup(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
