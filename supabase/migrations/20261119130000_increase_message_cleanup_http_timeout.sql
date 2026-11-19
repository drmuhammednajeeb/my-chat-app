-- Increase the scheduled Edge Function request timeout to provide headroom
-- for Storage API deletion batches. This updates the configuration function only;
-- the existing cron job is not rescheduled by this migration.
BEGIN;

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
        timeout_milliseconds := 10000,
        body := jsonb_build_object('triggered_at', pg_catalog.clock_timestamp())
      );
    $command$
  );

  RETURN v_job_id;
END;
$function$;

COMMENT ON FUNCTION app_private.configure_message_auto_cleanup(text) IS
  'Requires the project default sb_secret_ key to be pre-stored in Vault as message_cleanup_backend_key. The key is sent only through apikey to an Edge Function configured with auth: secret and verify_jwt=false. Scheduled calls use a 10-second pg_net timeout; re-run the owner-only configuration function to update an existing cron job.';

COMMIT;
