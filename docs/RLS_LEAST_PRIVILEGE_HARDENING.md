# RLS and least-privilege hardening — test-only

## Scope and safety

This work is a disposable-local test overlay, not a production migration. It must never be applied to a hosted Supabase project. The overlay requires database `postgres`, role `postgres`, and a transaction GUC that is set only by `local-rls-least-privilege-runtime.mjs`. That runner validates the client connection URL is loopback-only on port 54322 before invoking psql. The SQL itself does not inspect the server-side container IP because Docker may expose a private bridge address even when the client connects to loopback. The disposable-local runner and the least-privilege overlay executed in workflow run 43255877527 up to the separate forward-migration stage; the forward default-privilege migration then exposed an unsupported attempt to alter the Supabase-managed `supabase_admin` role. The candidate is narrowed to the observed `postgres` owner ACLs and is being rerun.

Production was inspected read-only. The observed application tables had RLS enabled, but the effective ACLs and default ACLs showed broader privileges than the application needs. In particular, the `postgres` default ACL for the `public` schema granted all table privileges to `anon` and `authenticated`; current application tables inherited table privileges including `TRUNCATE`, `REFERENCES`, `TRIGGER`, and (on the inspected PostgreSQL version) `MAINTAIN`. A focused effective-privilege count confirmed that `anon` held `TRUNCATE`, `REFERENCES`, and `TRIGGER` on 13 of 24 application tables, while `authenticated` held them on 14 of 24. These privileges are not constrained by row policies.

## Test-only overlay

`tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql`:

- Removes default table, sequence, and function grants to `PUBLIC`, `anon`, and `authenticated` for future objects created by the `postgres` application migration owner in `public`.
- Removes all direct public-table and sequence privileges from `anon`.
- Adds a `RESTRICTIVE FOR ALL TO authenticated` active-membership guard to every postgres-owned application table in `public` and to `storage.objects`. Feature-specific permissive policies remain in place; the restrictive guard is ANDed with them, so a future permissive policy cannot independently bypass active membership.
- Removes `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17+ `MAINTAIN` from `authenticated`.
- Removes direct DML that is not part of the application contract: membership event writes, edit-history inserts, private reply-context updates/deletes, star updates, account-settings deletes, chat-list-item updates, and group-settings deletes.
- Revokes public/anon execution of public-schema functions and explicitly removes client execution from the message trigger function.
- Preserves the existing authenticated CRUD grants and RPC grants needed by the reviewed client paths.

The overlay is followed by `rls-least-privilege.assert.sql`, which is read-only and verifies RLS enablement, policy coverage, active-member guards, unsafe table privileges, sequence/function ACLs, default ACLs, private-schema isolation, SECURITY DEFINER search paths, and Storage bucket/policy boundaries. The assertion also requires the test-only `chat-media` upload policy to bind folder segment 2 to `auth.uid()`.

## Production findings — read-only catalog evidence

- RLS was enabled on every application table inspected in `public` and `app_private`, and on `storage.objects`.
- Storage object policies were restricted to `authenticated`. The private `chat-media`, `conversation-documents`, and `channel-avatars` buckets were private. The `avatars` bucket was explicitly public by design; public delivery bypasses object SELECT policies, so only content intended for public viewing belongs there.
- The production `chat-media` INSERT policy did not bind path segment 2 to `auth.uid()`. A separate test-only replacement policy adds this uploader-folder check; it still requires disposable-local upload and cross-user path tests.
- All 50 inspected `public` policies were permissive, and all authenticated public policies included the active-member predicate (zero missing guards). All 15 Storage object policies were bucket-scoped; the test overlay adds a restrictive active-member guard across the Storage object table as defense in depth.
- The profile-directory policy allows every active member to read all `profiles` columns. The client intentionally requests `membership_number` and `membership_number_verified` for directory results. This is a visibility decision that should be confirmed as a product requirement; narrowing it requires a separate profile-directory/self-profile design and client changes, not a blanket RLS edit.
- The application `public` table default ACL for role `postgres` granted all table privileges to `anon` and `authenticated`. The same broad default existed for sequences and function EXECUTE. Effective ACL checks counted 13/24 tables with the three non-RLS privileges for `anon` and 14/24 for `authenticated`.
- Several authenticated roles had non-RLS table privileges and direct DML permissions beyond their intended contract.
- The Security Advisor separately reported leaked-password protection disabled.

This is a privilege-baseline defect, not proof that an unauthenticated request has already read or changed application rows. RLS still applies to ordinary row operations; however, `TRUNCATE`, `REFERENCES`, and `TRIGGER` are not row-policy operations, so they must not be granted to API roles.

## Runtime validation result — passed

The complete disposable-local Supabase workflow passed on commit `c97b36d3a603380cb80dd6cde2374ea1d3438731` (workflow run `43258867470`):

- 83 SQL files executed in the reviewed DAG order.
- The forward privilege migration and active-membership RLS migration applied successfully in the disposable stack.
- Read-only catalog assertions and rollback-only authenticated CRUD/RPC compatibility tests passed after the forward migrations.
- 24 reversed-pair concurrent direct-conversation requests converged on one conversation; 40 concurrent authenticated message writes persisted uniquely.
- The actual loopback-only pg_cron probe executed a temporary job successfully and cleaned it up.
- Storage API tests passed upload, signed reads, document sharing, avatar upsert, and cross-user uploader-folder spoof denial.

The same commit passed the SQL manifest audit (77/77 tests, workflow run `43258867403`). These results apply only to the disposable local Supabase environment; no production DDL or data was changed.

No production DDL, ACL change, RLS change, or deployment is authorized by this local test evidence. The four forward migrations remain unapplied to production pending a separate approval and deployment plan.


## Manual runtime invocation (disposable local stack only)

After the approved synthetic replay has completed and the local Auth/Storage services are healthy, obtain the local-only values from the Supabase CLI status output and export them in the same shell. Never copy hosted project keys into these variables.

```bash
export LOCAL_SUPABASE_DB_URL='postgresql://postgres:<local-db-password>@127.0.0.1:54322/postgres'
export LOCAL_SUPABASE_URL='http://127.0.0.1:54321'
export LOCAL_SUPABASE_ANON_KEY='<local-anon-key>'
export LOCAL_SUPABASE_SERVICE_ROLE_KEY='<local-service-role-key>'

node tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs
node tests/staging/local-supabase/local-storage-rls-runtime.mjs
```

The SQL runner applies the test-only overlay, checks catalog postconditions, and runs the rollback-only CRUD/RPC fixture. The separate forward migration narrows its scope to the `postgres` owner defaults and fails closed if `supabase_admin` begins owning public-schema objects; it does not attempt to alter Supabase-managed role defaults. The Storage runner uses the local Auth admin API to set random passwords on the two reserved synthetic `.test` users, signs in through the local Auth API, and exercises actual Storage HTTP endpoints. It removes only the uniquely named test objects and document row it creates. The direct conversation remains synthetic local data and is removed with the disposable database.

Both runners refuse non-loopback targets. The Storage runner requires the local API port 54321; the SQL runner requires the local PostgreSQL port 54322. The workflow `.github/workflows/disposable-local-supabase-runtime.yml` automates this sequence on a fresh GitHub-hosted disposable runner: it initializes a separate temporary Supabase project, pins PostgreSQL 17 and Supabase CLI 3.0.0, starts only local services, replays the exact DAG order through loopback-only connections, runs the SQL and Storage probes, and stops the temporary stack even on failure. It has been committed to the engineering branch; the disposable-local runtime workflow has passed (workflow run `43258867470`, 83 SQL files). The repository's global bootstrap and deployment gates remain fail-closed.


## Supabase-managed `supabase_admin` default ACL boundary

A direct read-only production catalog query on 2026-11-12 confirmed that the `supabase_admin` default ACLs in `public` still grant API-role privileges for tables, sequences, and functions. The same query confirmed:

- `postgres` is not a member of `supabase_admin` (`pg_has_role('postgres','supabase_admin','MEMBER') = false`).
- `supabase_admin` is a managed superuser role; the application migration role is not authorized to alter its default privileges.
- No current `public` relation or function is owned by `supabase_admin`.
- The forward migration hardens defaults for `postgres` and fails closed if a public relation or function becomes owned by `supabase_admin`; it does not attempt to grant role membership or mutate managed-role ACLs.

This is an external platform configuration residual, not an application-object exposure observed in the current catalog. It must be reviewed with the Supabase project administrator/support before any claim that every future platform-created public object inherits a deny-by-default ACL. Do not attempt to work around the role boundary by granting membership to `postgres` or escalating privileges in an application migration.
