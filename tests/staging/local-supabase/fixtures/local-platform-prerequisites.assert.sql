-- TEST ONLY: read-only platform prerequisites for disposable local Supabase.
-- Run after the local stack starts and BEFORE any application SQL replay.
-- This assertion performs no DDL, DML, extension installation, or network access.

DO $platform_preflight$
DECLARE
  v_missing text[];
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Refusing platform preflight outside the expected local postgres database';
  END IF;

  SELECT array_agg(required.name ORDER BY required.name) INTO v_missing
  FROM (VALUES
    ('auth'), ('storage'), ('realtime'), ('extensions')
  ) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = required.name);
  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Supabase-managed schemas are missing: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT array_agg(required.name ORDER BY required.name) INTO v_missing
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_admin')) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = required.name);
  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Required Supabase roles are missing: %', array_to_string(v_missing, ', ');
  END IF;

  IF to_regclass('auth.users') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Required Auth or Storage catalog objects are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Supabase Realtime publication is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto'
  ) THEN
    RAISE EXCEPTION 'pgcrypto is unavailable in the local PostgreSQL image';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
  ) OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto must already be installed in schema extensions with digest and gen_random_bytes; stop and review a disposable-only bootstrap patch before replay';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'pg_cron is unavailable in the local PostgreSQL image';
  END IF;

  RAISE NOTICE 'PASS: Supabase Auth, Storage, Realtime, roles, pgcrypto schema, and pg_cron availability verified';
END
$platform_preflight$;
