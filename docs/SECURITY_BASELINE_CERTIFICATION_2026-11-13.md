# Security Baseline Certification — 2026-11-13

## Decision

**Status: NOT CERTIFIED FOR PRODUCTION YET.**

The repository has a successful disposable-local security/runtime replay and the security forward migrations are present in source. The live Supabase project still has unapplied security migrations and two Security Advisor warnings. Keep the current stable source snapshot intact and do not label it production-certified until the remaining release gates below are closed.

## Scope and evidence

- Repository: `drmuhammednajeeb/my-chat-app`
- Reviewed branch/commit: `feat/voice-duration-render-performance-mainline` / `db6889efbcd25ecf6ff14a5595a66d7d8e2ab694`
- Review branch: `security/baseline-hardening-20261113`
- Production Supabase project: `lvkeohpuucuklagvwpnq` (`my-chat-app`), PostgreSQL 17.11, ACTIVE_HEALTHY
- Production migration ledger at inspection: 62 entries through `20261112103237`
- PR #141: open, not merged, mergeable; latest six required workflow runs passed.
- No production SQL, Auth settings, deployment, or merge was changed during this certification work.

## Verified checks

The latest PR commit passed all six workflows:

1. Disposable local Supabase runtime — successful; replay and cleanup steps completed.
2. Message lifecycle regression — successful; source-contract, profile-status/conversation-image, local/cloud separation, Chromium and browser integration steps completed.
3. Local Supabase SQL manifest audit — successful.
4. Encrypted backup/restore validation — successful (synthetic workflow validation, not a restore of production data).
5. Chat regression tests — successful.
6. Forever membership number format — successful.

The disposable runtime is isolated and is not the hosted production database. Browser regression success is not evidence of a full hosted Auth/Realtime/Storage E2E test or production load capacity.

## Live production findings (read-only)

### Positive controls

- Supabase project reports ACTIVE_HEALTHY on PostgreSQL 17.11.
- All 26 public tables returned by the current inventory have RLS enabled.
- The production migration ledger contains 62 applied versions.
- `public.set_conversation_image(uuid,text)` uses SECURITY DEFINER with an empty search_path and checks `auth.uid()`, active membership, conversation-management permission, caller-specific object path, and object existence before updating a conversation image.
- `app_private` schema usage is granted to authenticated and denied to anon; inspected helper functions use an empty search_path.

### Open production security findings

1. **Direct conversation eligibility:** live RPC implementation still needs the forward eligibility guard requiring active membership, verified official membership number, expected format, and confirmed Auth email for both participants.
2. **Chat-media uploader ownership:** the live Storage INSERT policy checks conversation membership and active membership but does not bind path segment 2 to `auth.uid()`.
3. **Default and direct PostgreSQL privileges:** the live `postgres` default ACL for public tables, sequences and functions remains broad for API roles. Several current tables also retain unnecessary direct privileges. The `supabase_admin` default ACL is platform-managed; the migration role cannot alter it. Read-only inspection found no current public application objects owned by `supabase_admin`.
4. **Auth leaked-password protection:** Supabase Security Advisor reports this setting is disabled. It is an Auth project setting, not a SQL migration; the available project integration does not expose a safe update operation for it.
5. **SECURITY DEFINER RPC advisory:** Security Advisor flags `public.set_conversation_image` because authenticated users can execute it. The inspected body has explicit authentication, active-membership, manager and object-path checks. This is an intentionally authenticated RPC surface, but its exposure must remain explicitly reviewed; do not remove its grant without verifying all clients and call paths.

Security Advisor currently reports two findings: the `set_conversation_image` SECURITY DEFINER warning and leaked-password protection disabled. Performance Advisor reports 28 unused-index notices. These are not reasons to delete indexes; review query plans and production workload before any index removal.

## Existing forward migrations — source present, production unapplied

The following files are already in the canonical migration source stream and have passed disposable-local replay:

- `20261112160000_harden_direct_conversation_eligibility.sql`
- `20261112160001_harden_chat_media_upload_ownership.sql`
- `20261112160002_revoke_unsafe_public_default_privileges.sql`
- `20261112160003_enforce_active_membership_rls.sql`

The current production ledger does not contain these versions. The disposable runtime evidence verifies their behavior only in the isolated local database. Applying them to production remains a separate controlled release operation after backup verification and a production change window.

PR #141 also adds `202611130001_chat_message_audio_duration.sql`. This is a feature migration, not part of the security hardening set; do not apply it as part of this security certification unless the voice-duration feature release is separately approved.

## External platform residual

The `supabase_admin` default ACL grants remain controlled by Supabase. The application migration role is not a member of that managed role, and should not be granted elevated membership to work around the restriction. The forward migration fails closed if `supabase_admin` begins owning public application objects. This boundary requires platform-owner review; current inspection found no public application objects owned by `supabase_admin`.

## Required closure gates

1. Confirm a current recoverable production backup/snapshot and a tested restore procedure for the actual production project.
2. Review and approve the four security forward migrations against the current production catalog, then apply them in order in a controlled window.
3. Verify post-migration effective grants, default ACLs, restrictive active-membership policies, direct-conversation eligibility, and Storage uploader path ownership with read-only catalog assertions and real authenticated probes.
4. Enable leaked-password protection in Supabase Auth settings and verify the Security Advisor no longer reports it.
5. Retain the `set_conversation_image` RPC only after confirming the authenticated caller contract and documenting the intentional SECURITY DEFINER boundary; if refactoring to an invoker wrapper/private definer implementation, add migration and regression tests first.
6. Run hosted two-account E2E against an isolated non-production Supabase project, including live Realtime delivery/reconnect, groups/channels, attachments, voice, edit/delete, and unauthorized third-party access.
7. Run a bounded read/write/Realtime/Storage load test with a stated request rate, duration, error budget and cleanup plan.
8. Re-run all required CI checks after any code or migration change.
9. Only then create an immutable baseline tag with commit SHA, migration ledger snapshot, CI run links, advisor report and backup/restore evidence.

## Release protection

- Keep `main` and the currently retained reference snapshot unchanged.
- Keep PR #141 open until its independent feature migration is approved and all required checks remain green.
- Do not merge, deploy, or apply production migrations as a side effect of documentation certification.
- Do not call this version production-safe until every required closure gate above is evidenced.
