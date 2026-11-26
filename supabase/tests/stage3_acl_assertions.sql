-- Stage 3 ACL assertions. Run against a disposable local Supabase DB after migrations.
DO $assert_api_table_acl$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  LOOP
    IF has_table_privilege('anon',r.oid,'TRUNCATE') OR has_table_privilege('anon',r.oid,'TRIGGER')
       OR has_table_privilege('anon',r.oid,'REFERENCES') THEN
      RAISE EXCEPTION 'anon unexpected privilege on public.%',r.relname;
    END IF;
    IF has_table_privilege('authenticated',r.oid,'TRUNCATE') OR has_table_privilege('authenticated',r.oid,'TRIGGER')
       OR has_table_privilege('authenticated',r.oid,'REFERENCES') THEN
      RAISE EXCEPTION 'authenticated unexpected privilege on public.%',r.relname;
    END IF;
  END LOOP;
END;
$assert_api_table_acl$;

-- Do not assert EXECUTE absence for delete_message_secure: its reviewed, author-only
-- 15-minute delete contract intentionally exposes this SECURITY DEFINER RPC.
-- Do not create an RLS policy for app_private.message_cleanup_queue; it is worker-only.
