-- Stage 3 ACL assertions. Run after migrations against a disposable DB.
DO $assert_api_table_acl$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  LOOP
    IF has_table_privilege('anon',r.oid,'TRUNCATE') OR has_table_privilege('anon',r.oid,'TRIGGER')
       OR has_table_privilege('anon',r.oid,'REFERENCES') THEN
      RAISE EXCEPTION 'anon unexpected table control privilege on public.%',r.relname;
    END IF;
    IF has_table_privilege('authenticated',r.oid,'TRUNCATE') OR has_table_privilege('authenticated',r.oid,'TRIGGER')
       OR has_table_privilege('authenticated',r.oid,'REFERENCES') THEN
      RAISE EXCEPTION 'authenticated unexpected table control privilege on public.%',r.relname;
    END IF;
  END LOOP;
END;
$assert_api_table_acl$;

-- MAINTAIN is available in PostgreSQL 17+; use dynamic SQL for version compatibility.
DO $assert_maintain$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE $check$
      DO $inner$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
        LOOP
          IF has_table_privilege('anon',r.oid,'MAINTAIN') THEN
            RAISE EXCEPTION 'anon unexpected MAINTAIN privilege on public.%',r.relname;
          END IF;
          IF has_table_privilege('authenticated',r.oid,'MAINTAIN') THEN
            RAISE EXCEPTION 'authenticated unexpected MAINTAIN privilege on public.%',r.relname;
          END IF;
        END LOOP;
      END $inner$;
    $check$;
  END IF;
END;
$assert_maintain$;

-- Keep the reviewed delete RPC EXECUTE grant: it enforces author-only,
-- active-membership and the DB-clock 15-minute deletion contract.
-- Keep app_private.message_cleanup_queue worker-only; do not add a client RLS policy.
