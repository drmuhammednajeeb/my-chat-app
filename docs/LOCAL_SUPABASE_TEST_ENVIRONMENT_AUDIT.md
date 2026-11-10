# Local Supabase Test Environment — Readiness Audit

**Audit date:** 2026-11-09  
**Decision:** GitHub-hosted ephemeral Supabase is the preferred zero-cloud-cost isolation path, but the repository is not yet ready to boot it safely.

## Cost and isolation model

The repository is public. A GitHub-hosted Linux Actions runner can host an ephemeral Docker-based local Supabase stack for the duration of a workflow. This avoids creating a Supabase cloud project, a paid development branch, or storing any production credentials. The stack and its test data are discarded with the runner.

This is the preferred target architecture, subject to confirming the applicable GitHub Actions usage limits for the repository owner. Do not create cloud resources or use paid runners.

## Findings from repository inspection

- No `supabase/config.toml` exists at the audited branch head.
- `supabase/migrations/` contains 10 files.
- `database/changes/` contains 43 SQL files; these are not automatically part of the Supabase CLI migration sequence.
- Three SQL files are byte-identical duplicates across the two directories:
  - `202611060007_harden_chat_table_privileges.sql` and `chat_table_privilege_hardening.sql`
  - `20261107014128_unified_user_notifications.sql` and `unified_notifications.sql`
  - `20261107014350_index_user_notification_foreign_keys.sql` and `index_user_notification_foreign_keys.sql`
- The first migration, `202611060001_ultra_chat_pro_v2.sql`, starts by altering/revoking access on `public.messages`. The app's current message table is `public.chat_messages`; the legacy table is not guaranteed to exist in a clean database.
- `202611060006_explicit_legacy_deny.sql` also creates a policy on `public.messages`. It fails on a clean database where that legacy table does not exist.
- The repository README explicitly warns that the two SQL directories are not yet a single canonical, fully ordered migration history.

## Consequence

Do **not** run `supabase start` / `supabase db reset` against the current migration directory and assume that it creates a valid application database. The clean-database bootstrap is not yet proven. Do not repair or delete production migration files as part of test setup.

## Safe implementation sequence

1. Create a dedicated local-only Supabase config for CI; do not link it to any hosted project.
2. Build a test-only bootstrap manifest from reviewed SQL sources. It must identify required base schema, ordered feature changes, duplicate files, and legacy-only statements. It must not silently skip SQL or rewrite canonical migrations.
3. Run the bootstrap against an ephemeral local database and fail on the first SQL error. No remote DB credentials, project ref, or network target may be passed to this job.
4. Create disposable Auth users and deterministic fixtures only inside the local stack. Do not import production users, messages, memberships, or Storage objects.
5. Start the static app locally and inject only the local Supabase URL and locally generated public anon key in the test process. Assert at runtime that the browser's Supabase requests target loopback only.
6. Add two-browser E2E coverage: authentication/session restore, direct chat send/receive, Realtime delivery/reconnect, duplicate retry/idempotency, pagination, edit/delete, receipts, group/channel access, attachment Storage, and a third non-member authorization check.
7. Add bounded concurrency tests against the local stack, with explicit concurrency, duration, and cleanup limits. Report them as local-stack tests, not cloud capacity benchmarks.

## Hard safety rules

- The test runner must reject the production project ref/host and must not accept an arbitrary remote Supabase URL.
- Do not use the production publishable key, service-role key, Auth users, or database data.
- Never run cleanup outside the local disposable project.
- Keep service-role credentials inside the isolated CI process only; never expose them to browser code or logs.
- Do not configure paid services, paid runners, cloud staging projects, or development branches.
- Until the bootstrap manifest and local stack pass, classify real application E2E as **BLOCKED / NOT RUN**.

## Current verification evidence

- Staging preflight and simulation workflow: passed on commit `a891e43d28c8ea640e030d48d1cb5c73377cef84`.
- The workflow ran with no Staging secrets. Preflight selected `VALIDATION_ONLY`.
- 9/9 tests passed: 7 preflight contract tests and 2 in-memory concurrency simulations.
- This does not prove database migration validity, Auth, RLS, Realtime, Storage, or application E2E behavior.
