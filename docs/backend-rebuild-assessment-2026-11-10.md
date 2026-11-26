# Backend and Supabase Rebuild Assessment

**Assessment date:** 2026-11-10  
**Scope:** `my-chat-app` only  
**Method:** GitHub source review, CI run/log review, and read-only Supabase catalog/advisor queries.  
**Change policy:** This document records findings and a safe execution plan. It does not authorize or perform production DDL, data changes, deletion, migration repair, merge, or deployment.

## Executive decision

Do not delete or recreate the existing Supabase project. The live database contains application data and a functioning multi-feature schema. Rebuild the database delivery system around a canonical, reproducible migration stream, validate it in disposable local Supabase, and only then plan a controlled staging/production transition.

The current source tree is not a single executable migration history. It contains 10 files under `supabase/migrations` and 44 historical SQL files under `database/changes`. The live remote migration ledger returned 59 applied migration records on 2026-11-10. Three identical SQL copies are excluded from the reviewed source DAG, leaving 51 unique mapped SQL sources. Three ledger records have no original SQL source in the current repository, and two direct-conversation RPC records are represented only by catalog-recovered test fixtures, not original migration files. See the separate migration reconciliation report in PR #78 for the full version-to-source matrix. A reviewed replay manifest maps sources and fixtures into an execution order, but that is not yet a canonical production migration stream.

## 1. Live database observations (read-only)

The Supabase project named `my-chat-app` is active on PostgreSQL 17.11.0.018.

- 24 base tables were observed in the `public` schema; all 24 had RLS enabled at the time of inspection.
- The legacy `public.messages` table still exists. The table inventory reported zero rows. Do not drop it until all legacy references, backups, and application dependencies are formally retired.
- The current schema includes profiles, conversations, conversation_members, chat_messages, notifications, reactions, pins, workspaces/documents, private reply contexts, user preferences/lists, and membership administration objects.
- The live remote migration ledger returned 59 applied migration records. The current repository contains 10 CLI migration files plus 44 historical SQL files. The full mapping and unresolved source gaps are documented separately.

### Critical privilege findings

Read-only inspection of `information_schema.role_table_grants` found:

- `anon` has table-level privileges on 13 public tables, including TRUNCATE, REFERENCES, and TRIGGER.
- `authenticated` has TRUNCATE, REFERENCES, and TRIGGER on 14 public tables.
- PostgreSQL default ACLs for objects created by both `postgres` and `supabase_admin` in `public` include broad table privileges for `anon` and `authenticated` (`arwdDxtm`), sequence privileges (`rwU`), and function EXECUTE (`X`).

RLS being enabled on all 24 public tables is positive, but RLS does not neutralize table-level TRUNCATE privileges. These grants and default ACLs are a high-priority least-privilege remediation item. Do not apply a broad REVOKE in production without first proving the exact application CRUD/RPC contract and a rollback plan.

### Critical Storage finding

The live `storage.objects` policy named `Conversation members upload chat media` checks conversation membership and active membership, but its `WITH CHECK` does **not** bind the second path segment to `auth.uid()`. The disposable-local test fixture `chat-media-upload-path-hardening.sql` adds that ownership condition. That fixture is test-only and has not been deployed to production.

Before any production policy change, validate legitimate uploads, reads, replacements, deletes, and cross-user path-spoof rejection through the Storage API in an isolated environment.

### Supabase Advisors

- **Security:** warning — leaked-password protection is disabled in Supabase Auth.
- **Performance:** 29 unused-index findings (INFO). Do not remove these indexes solely from this snapshot; the workload is small and usage history may be incomplete.
- **Health:** no advisor lints returned at inspection time.

## 2. Source and migration blockers

The reviewed source inventory identifies these blockers:

1. Migrations `202611060001_ultra_chat_pro_v2.sql` and `202611060006_explicit_legacy_deny.sql` reference `public.messages` without a canonical preceding definition in the CLI migration stream.
2. `202611060007_harden_chat_table_privileges.sql` references feature tables, helper functions, and membership columns introduced by historical SQL or later source files.
3. `database/changes` is not a canonical ordered migration stream; filename order alone does not prove dependencies.
4. Duplicate SQL copies exist across source directories and require explicit provenance decisions.
5. Historical migration `20261107152733_fix_official_membership_invite_duplicate_validation.sql` is missing a statement terminator in the canonical historical source; a test-only syntax-corrected fixture was used in the replay.
6. The membership-number migration depends on functions, tables, and constraints established in historical SQL, not solely by the CLI migration chain.
7. Direct-conversation eligibility, authorization, concurrency, RLS, and Storage require runtime evidence and must not be inferred from static source tests.

## 3. Verified disposable-local runtime evidence

GitHub Actions run [42858753079](https://github.com/drmuhammednajeeb/my-chat-app/actions/runs/42858753079) completed successfully on an ephemeral local Supabase/PostgreSQL 17 stack.

The run log records:

- Local platform preflight passed for Auth, Storage, Realtime, roles, pgcrypto, and pg_cron availability.
- pg_cron probe executed successfully; catalog/job-definition checks passed.
- 66 SQL source/fixture files were executed in the reviewed local replay.
- Four source substitutions were test-only fixtures; canonical production SQL files were not modified by those substitutions.
- 24 concurrent reversed-pair direct-conversation requests converged on one conversation.
- 40 concurrent authenticated message writes persisted uniquely.
- Disposable least-privilege overlay and assertions passed.
- Storage API RLS integration passed.
- The ephemeral Supabase stack was stopped during cleanup.

Related runs:
- [Message lifecycle regression — 42858753172](https://github.com/drmuhammednajeeb/my-chat-app/actions/runs/42858753172): success, including Chromium browser integration.
- [Local Supabase SQL manifest audit — 42858753200](https://github.com/drmuhammednajeeb/my-chat-app/actions/runs/42858753200): success.

**Limits:** These are isolated local runtime results using synthetic users and test-only fixtures. They do not establish production migration safety, complete authenticated browser E2E against a staging project, Realtime reconnect/isolation under real multi-client load, or capacity for 500/5,000 concurrent users.

## 4. Current release posture

PR [#76](https://github.com/drmuhammednajeeb/my-chat-app/pull/76) remains open and unmerged. Its validation section has been updated with the successful disposable-local runtime evidence. Do not merge until the remaining release gates pass.

The existing `.github/workflows/staging-e2e-readiness.yml` is not a full staging E2E workflow: it runs a configuration preflight and an explicitly in-memory concurrency simulation. It does not authenticate against a staging Supabase instance or exercise the full application with real Realtime and Storage.

No separate cloud staging Supabase project was created. The current two-project allocation is preserved; the store project is out of scope.

## 5. Recommended execution plan

### Phase A — Freeze and reconcile

- Preserve the current Supabase project, data, backups, and migration ledger.
- Produce a source-to-remote-ledger mapping for all 60 applied migration versions.
- Reconcile every SQL source, duplicate, test fixture, and missing historical file.
- Capture a complete read-only inventory of tables, columns, constraints, indexes, sequences, views, functions, triggers, RLS policies, grants/default ACLs, Storage buckets/policies, Realtime publication membership, extensions, and pg_cron jobs.
- Identify which features are actively used by the current application before any schema simplification.

### Phase B — Canonical schema and migration stream

- Define one canonical migration directory and one deterministic dependency order.
- Separate managed-platform prerequisites from application-owned schema.
- Establish core identity/membership, conversations, messages, attachments, notifications, and feature modules in explicit dependency layers.
- Remove legacy `messages` assumptions only after the migration ledger and application references prove they are obsolete.
- Make all migrations idempotent where appropriate and verify full replay from an empty local database.
- Keep synthetic users, compatibility shims, and security overlays under test fixtures only; never silently fold them into production migrations.

### Phase C — Security baseline

- Revoke unnecessary default privileges for both relevant object owners, then explicitly grant only the operations required by the application.
- Verify table, column, sequence, schema, and function EXECUTE privileges independently.
- Keep `app_private` unexposed and tightly permissioned.
- Review every SECURITY DEFINER function for fixed search_path, owner, explicit authorization checks, and minimal EXECUTE grants.
- Require active membership and correct conversation scope for every protected data path.
- Bind Storage upload paths to the authenticated owner where the feature requires per-user ownership.
- Test both positive and negative behavior with at least two ordinary users and one unauthorized user.

### Phase D — End-to-end and load verification

- Run the actual application against a disposable Supabase environment with synthetic Auth users.
- Exercise sign-in/session refresh, direct/group/channel creation, send/edit/delete/reply/reaction/pin/receipt, notifications, attachments, private documents, and membership lifecycle.
- Verify Realtime subscribe, reconnect, duplicate delivery, ordering, and cross-conversation isolation.
- Run database-backed concurrency tests at increasing levels (for example 50, 100, 500, then 5,000 operations where the runner can sustain them); report latency percentiles, error rate, lock waits, duplicate rate, and resource saturation.
- Keep in-memory simulations labeled as simulations; they are not backend load tests.

### Phase E — Controlled transition

- Establish a genuine staging target only after its cost, lifecycle, and project/branch strategy are explicitly approved.
- Apply the canonical migration chain to staging and repeat the full test matrix.
- Plan a reversible data migration and compare row counts, constraints, ownership, and application behavior.
- Use a maintenance/cutover window, backup verification, rollback checkpoint, and explicit approval before production changes.
- Never run a destructive reset against the existing production project.

## 6. Current decision gates

| Gate | Status |
|---|---|
| Preserve production and store projects | PASS — no destructive action taken |
| Message lifecycle regression | PASS |
| Static SQL manifest audit | PASS |
| Disposable local Supabase replay | PASS |
| Local direct-conversation concurrency probe | PASS — 24 reversed-pair requests |
| Local authenticated message write probe | PASS — 40 concurrent writes |
| Local pg_cron execution probe | PASS |
| Local least-privilege overlay assertions | PASS |
| Local Storage API RLS probe | PASS |
| Canonical production migration stream | BLOCKED |
| Production default ACL / table-grant remediation plan | BLOCKED — requires complete CRUD/RPC compatibility evidence |
| Production chat-media path ownership fix | BLOCKED — local fixture only |
| Full authenticated application E2E against staging | NOT RUN |
| Realtime multi-client reconnect/isolation load | NOT RUN |
| 500/5,000-user capacity test | NOT RUN |
| Production migration / data cutover | NOT AUTHORIZED |

## 7. Supabase platform notes

- Supabase CLI v3 became the default release channel on 2026-11-02. Keep CI CLI versions pinned and review CLI v3 behavior before changing the pin. The local runtime workflow currently pins v3.0.0; its run log noted v3.1.0 was available.
- Supabase's Data API exposure behavior changed: new public tables are no longer automatically exposed by default, with enforcement on all projects from 2026-10-30. New schema design must explicitly decide API exposure and grants rather than assuming a public table is reachable.
- References: [Supabase CLI v3 breaking change](https://supabase.com/changelog); [Data API security guide](https://supabase.com/docs/guides/api/securing-your-api).

---

**Final recommendation:** retain the existing project and its data; treat the successful disposable-local replay as a major verification milestone, not production approval. The next engineering work should focus on canonical migration reconciliation and a production-compatible least-privilege remediation design, validated entirely outside production before any deployment.
