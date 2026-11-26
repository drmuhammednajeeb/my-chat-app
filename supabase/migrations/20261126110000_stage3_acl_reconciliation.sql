-- Stage 3: narrowly reconcile non-RLS table control privileges.
-- Preserve ordinary CRUD grants; revoke only control privileges identified by audit.
-- Forward-only and idempotent. Replay and test on a disposable database first.
BEGIN;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;

DO $maintain_revoke$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC';
  END IF;
END;
$maintain_revoke$;

DO $assert_privileges$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    IF has_table_privilege('anon', r.oid, 'TRUNCATE')
       OR has_table_privilege('anon', r.oid, 'TRIGGER')
       OR has_table_privilege('anon', r.oid, 'REFERENCES') THEN
      RAISE EXCEPTION 'anon retains table control privilege on public.%', r.relname;
    END IF;
    IF has_table_privilege('authenticated', r.oid, 'TRUNCATE')
       OR has_table_privilege('authenticated', r.oid, 'TRIGGER')
       OR has_table_privilege('authenticated', r.oid, 'REFERENCES') THEN
      RAISE EXCEPTION 'authenticated retains table control privilege on public.%', r.relname;
    END IF;
  END LOOP;

  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE $check_maintain$
      DO $inner$
      DECLARE t record;
      BEGIN
        FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
        LOOP
          IF has_table_privilege('anon',t.oid,'MAINTAIN') THEN
            RAISE EXCEPTION 'anon retains MAINTAIN on public.%',t.relname;
          END IF;
          IF has_table_privilege('authenticated',t.oid,'MAINTAIN') THEN
            RAISE EXCEPTION 'authenticated retains MAINTAIN on public.%',t.relname;
          END IF;
        END LOOP;
      END $inner$;
    $check_maintain$;
  END IF;
END;
$assert_privileges$;

COMMIT;
