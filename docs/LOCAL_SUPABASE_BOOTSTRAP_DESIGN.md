# Local Supabase bootstrap design — blocked pending dependency proof

## Executive decision

**Status: BLOCKED / DESIGN ONLY.** No Supabase stack is started and no SQL is executed by this design. The canonical SQL sources are not yet a reproducible, dependency-ordered database build.

The repository contains 10 files under `supabase/migrations/` and 43 under `database/changes/`. The latter directory is historical change material, not a Supabase CLI migration stream. Neither timestamp order nor alphabetical order is sufficient evidence that the files can be applied in sequence.

The only permitted next implementation stage is to resolve the blockers below in a separately reviewed test-only schema plan. Canonical migrations and historical SQL remain unchanged.

## Full source review — findings

### 1. CLI migration sequence

| Source | Finding | Impact |
|---|---|---|
| `202611060001_ultra_chat_pro_v2.sql` | Immediately drops a policy, revokes privileges, and enables RLS on `public.messages`; no creation of that legacy table is present in the CLI migration set. | Clean bootstrap stops at the first statements unless an independently justified legacy compatibility fixture exists. |
| `202611060004_reference_profiles.sql` | Replaces three foreign keys to `auth.users` with references to `public.profiles`. | Depends on the profile table and its ID values being present and compatible. |
| `202611060006_explicit_legacy_deny.sql` | Creates a policy on `public.messages`. | Repeats the unresolved legacy-table dependency. |
| `202611060007_harden_chat_table_privileges.sql` | Uses `message_pins`, `message_reactions`, `app_private.is_team_admin()`, `app_private.enforce_group_member_limit()`, `app_private.get_or_create_direct_conversation_impl(uuid)`, and membership columns such as `last_delivered_at`. | These dependencies are not created by the preceding CLI migrations. Several appear only in historical SQL or are not established by the reviewed CLI sequence. |
| `20261107014128_unified_user_notifications.sql` | Creates notification triggers over profiles, conversations, messages and memberships, and adds the table to Realtime. | Requires the complete core schema and publication to exist first. |
| `20261107014350_index_user_notification_foreign_keys.sql` | Adds indexes to the notification table. | Must follow the notification table definition. |
| `20261108075913_unify_forever_membership_number_format.sql` | Rewrites six functions and alters membership constraints in `app_private.member_invitations` and `public.profiles`. | Depends on membership infrastructure introduced in historical SQL, not in the preceding CLI migration stream. |

### 2. Historical SQL dependency families

The 43 files span these feature families:

- Core preferences, self-chat and voice-message bucket configuration.
- Account settings, reactions, message editing, edit history, pins and delivery receipts.
- Group settings, membership events, ownership transfer, custom lists and favorites.
- Group expiry and scheduled cleanup using `pg_cron`.
- Private channels and bearer invite tokens using `pgcrypto` functions.
- Workspace labels, classifications, notes, documents and private reply contexts.
- Team-admin authority, member limits and team dashboard RPCs.
- Private membership invitations, auth signup triggers and official membership number verification.
- Notification triggers and Realtime publication membership.
- Final privilege hardening and RLS policy rewrites.

These families have cross-file dependencies. Examples:

- `202611060007` relies on pins/reactions, team-admin and group-limit objects that appear in historical SQL.
- `20261107050000_per_user_chat_archive_and_preferences_rls.sql` alters `user_chat_preferences`, which is created by `user_specific_direct_chat_preferences.sql`.
- `20261107061103_ensure_self_chat_rpc.sql` relies on the conversations and memberships schema and a matching partial unique index created separately.
- `private_channels_with_secure_invites.sql` relies on the conversations model, membership helpers and digest/random-byte extension functions.
- Workspace document policies rely on workspace tables, storage buckets, membership helpers and matching storage object paths.
- Membership RPCs depend on `app_private.team_admins`, invitation tables, auth triggers, profile columns and helper functions.
- The membership-number format migration in the CLI directory expects historical membership objects and functions.
- Notification triggers rely on profiles and the complete chat/member model; duplicate historical and CLI definitions must not be blindly replayed.

### 3. Duplicate source pairs

The following files are byte-identical (same Git blob content):

- `supabase/migrations/202611060007_harden_chat_table_privileges.sql` and `database/changes/chat_table_privilege_hardening.sql`
- `supabase/migrations/20261107014128_unified_user_notifications.sql` and `database/changes/unified_notifications.sql`
- `supabase/migrations/20261107014350_index_user_notification_foreign_keys.sql` and `database/changes/index_user_notification_foreign_keys.sql`

The test plan must record source provenance and include each logical change exactly once. The audit must never silently deduplicate or select one copy automatically.

### 4. Confirmed SQL syntax hazard

`database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql` ends the function body with `$function$` and immediately begins `REVOKE` / `GRANT` statements. The function definition requires the terminating semicolon (`$function$;`). The canonical file is not modified by this work. A test-only corrected copy may be considered only after the dependency plan is approved and the difference is documented.

### 5. Additional runtime-sensitive dependencies

- Storage policies require Supabase's local `storage` schema, bucket metadata and `storage.objects` table.
- Realtime additions require the local `supabase_realtime` publication and idempotent publication membership checks.
- Membership scheduling introduces `pg_cron`; it must be confirmed available and configured locally before its SQL is included.
- Channel invite helpers call `extensions.gen_random_bytes` and `extensions.digest`; extension installation schema and function resolution must be verified.
- Auth lifecycle migrations add BEFORE/AFTER triggers to `auth.users`; these require local Auth service schema and transaction-level tests.
- The dynamic policy rewrite in the membership system changes all policies targeting authenticated roles in `public` and `storage`; its exact generated SQL must be captured and reviewed before execution.

## Proposed isolated bootstrap architecture

The design intentionally separates platform services, schema fixtures and test execution:

1. **Platform layer:** a pinned Supabase CLI and Docker Compose stack inside a disposable GitHub-hosted runner. No cloud project link, access token, project reference or production secret.
2. **Platform readiness:** assert local Auth, Storage, Realtime, roles, schemas, publication and required extensions. Fail before SQL if any platform prerequisite is absent.
3. **Schema manifest:** a reviewed, explicit allowlist of test-only SQL files with source SHA-256, dependency IDs and order. Never glob either SQL directory for execution.
4. **Compatibility layer:** if required, keep any legacy `public.messages` fixture or syntax correction under `tests/staging/local-supabase/fixtures/`; do not patch canonical migrations. The fixture must be justified by application compatibility, not added merely to make a migration pass.
5. **Execution guard:** `bootstrap-guard.mjs` rejects a design-only plan, any non-loopback API/database host, and cloud/project/service-role credentials. It does not execute SQL.
6. **Fixtures:** synthetic Auth users and chat records only after schema creation and RLS review; no imported production rows or personal data.
7. **Verification:** SQL parse/apply rehearsal, catalog assertions, two-user RLS negative tests, Auth signup lifecycle, Storage ownership tests and Realtime publication checks.
8. **Cleanup:** destroy only the job's local stack and temporary files on success, failure or cancellation.

## Current guard implementation

- `bootstrap-plan.json` is `DESIGN_ONLY`, `BLOCKED`, and has an empty SQL execution list.
- `bootstrap-guard.mjs` is fail-closed. It requires a formally approved plan and loopback-only targets before a future runner can proceed.
- `bootstrap-guard.test.mjs` tests the blocked state, loopback acceptance, remote-target rejection, credential rejection and approval contract.
- No Docker, Supabase CLI, SQL engine or remote Supabase project is started by this stage.

## Exit criteria before any local Supabase startup

All of the following are mandatory:

1. Produce a catalog of every table, column, FK, constraint, index, sequence, function signature, trigger, policy, grant, storage bucket and Realtime publication entry.
2. Produce a dependency DAG with no unresolved object references and an explicit deterministic execution order.
3. Resolve the legacy `public.messages` references with a test-only compatibility decision supported by actual application requirements.
4. Resolve the three duplicate pairs with source provenance and one execution source per logical change.
5. Correct the known function terminator only in a test-only copy, with a hash and patch record.
6. Resolve membership schema and function dependencies before the format-normalization migration.
7. Validate the entire SQL set against a disposable local PostgreSQL instance without connecting to Cloud.
8. Run the bootstrap guard and prove that production and every non-loopback endpoint are rejected.
9. Demonstrate automatic local-stack cleanup after both successful and intentionally failed jobs.

Until these criteria are satisfied, **do not create `supabase/config.toml` as an execution-enabling step, do not run `supabase start` / `db reset`, and do not generate a bootstrap SQL bundle.**

## Audit status

The read-only manifest workflow passing means its Node tests and static inventory completed. It does not mean the SQL is executable, the dependency order is valid, or Supabase has been started.
