-- Forward reconciliation: enforce active membership as a non-bypassable RLS boundary.
-- Applied after the 62 historical migrations and after public-schema privilege hardening.
-- Restrictive policies compose with feature-specific permissive policies without replacing them.

BEGIN;

-- Add a restrictive membership gate in addition to each table's feature-specific
-- permissive policy. PostgreSQL combines permissive policies with OR, so this
-- restrictive guard prevents a later permissive policy from bypassing active status.
do $public_restrictive_guard$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relowner = 'postgres'::regrole
      and c.relrowsecurity
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Require active membership for all API operations',
      r.relname
    );
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select app_private.is_active_member())) with check ((select app_private.is_active_member()))',
      'Require active membership for all API operations',
      r.relname
    );
  end loop;
end;
$public_restrictive_guard$;

-- Apply the same non-bypassable active-member boundary to Storage API operations.
-- Do not query storage.buckets from this policy: private bucket rows may be hidden by
-- storage.buckets RLS, which would make the restrictive policy deny valid object writes.
-- storage.objects.bucket_id already has a foreign key to storage.buckets(id).
drop policy if exists "Require active membership for all Storage operations" on storage.objects;
create policy "Require active membership for all Storage operations"
on storage.objects as restrictive for all to authenticated
using ((select app_private.is_active_member()))
with check ((select app_private.is_active_member()));

COMMIT;
