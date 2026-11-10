-- TEST ONLY: read-only platform postconditions after the relevant local replay nodes.
-- Run only in the disposable local Supabase database after chat.workspaces and chat.expiry-purge.
-- This assertion performs no DDL, DML, scheduling, or network access.

DO $platform_postflight$
DECLARE
  v_job_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
  ) OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is not installed in the schema required by the application SQL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR to_regclass('cron.job') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'cron' AND p.proname = 'schedule'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'cron' AND p.proname = 'unschedule'
     ) THEN
    RAISE EXCEPTION 'pg_cron extension, cron.job, schedule, or unschedule is missing';
  END IF;

  SELECT count(*) INTO v_job_count
  FROM cron.job
  WHERE jobname = 'purge-expired-chat-messages'
    AND schedule = '*/5 * * * *'
    AND command = 'select app_private.purge_expired_chat_messages();';

  IF v_job_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one reviewed expired-message purge job; observed %', v_job_count;
  END IF;

  RAISE NOTICE 'PASS: pgcrypto placement and pg_cron installation/job definition verified; scheduler execution still requires a separate runtime check';
END
$platform_postflight$;
