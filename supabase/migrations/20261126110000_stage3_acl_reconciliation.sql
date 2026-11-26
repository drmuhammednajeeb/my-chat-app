-- Stage 3 privilege reconciliation: remove non-RLS API privileges that persisted
-- on selected public tables despite the historical forward-hardening baseline.
-- This is a forward-only, idempotent migration. Test locally before production use.
BEGIN;

-- anon must not have direct privileges on application tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, PUBLIC;

-- Authenticated clients must not have schema-level table control privileges.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, PUBLIC;
DO $maintain_guard$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated, PUBLIC';
  END IF;
END;
$maintain_guard$;

-- Assert effective privileges are gone; abort rather than silently ship drift.
DO $assert_privileges$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  LOOP
    IF has_table_privilege('anon', r.oid, 'TRUNCATE')
       OR has_table_privilege('anon', r.oid, 'TRIGGER')
       OR has_table_privilege('anon', r.oid, 'REFERENCES') THEN
      RAISE EXCEPTION 'anon retains non-RLS table control privilege on public.%', r.relname;
    END IF;
    IF has_table_privilege('authenticated', r.oid, 'TRUNCATE')
       OR has_table_privilege('authenticated', r.oid, 'TRIGGER')
       OR has_table_privilege('authenticated', r.oid, 'REFERENCES') THEN
      RAISE EXCEPTION 'authenticated retains non-RLS table control privilege on public.%', r.relname;
    END IF;
  END LOOP;
END;
$assert_privileges$;

COMMIT;
