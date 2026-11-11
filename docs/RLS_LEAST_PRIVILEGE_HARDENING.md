# RLS least-privilege hardening

## Current decision

**Production promotion: BLOCKED. Disposable-local runtime: PASSED.**

- The RLS overlay, direct-conversation eligibility guard, and chat-media uploader-folder guard have been exercised against a disposable local Supabase stack.
- No production SQL, ACL, policy, or data changes were executed.
- The production observations below were collected with read-only catalog queries only.
- The test-only overlays are not yet canonical production migrations and must not be applied to the live project as-is.

## Verified disposable-local runtime — 2026-11-11

The GitHub Actions disposable runtime completed successfully with:

- 66 SQL files replayed in reviewed dependency order.
- Four explicitly declared test-only fixture patches; canonical source files were not modified by the replay.
- RLS least-privilege catalog assertions and rollback-only CRUD/RPC compatibility tests passed.
- Storage API checks passed, including a valid uploader-folder upload, authorized member read, and denial of a different member spoofing the uploader folder.
- Direct-conversation eligibility assertions passed for unauthenticated, null, self, missing-profile, inactive, unverified, malformed-number, and unconfirmed-email cases.
- Twenty-four reversed-pair concurrent RPC requests converged on one conversation.
- Forty concurrent message writes were stored without duplicate message IDs.
- The local pg_cron execution probe passed and removed its temporary job.
- The actual application was served from a test-only copy of index.html rewritten to the loopback Supabase URL and local anon key. Browser E2E passed: user A signed in, opened user B's direct conversation, sent a message, user B read it, and the message remained after reload.
- Docker container egress was blocked through the DOCKER-USER firewall chain while local inter-container traffic and host-to-loopback test traffic remained available. GitHub runner host egress remains available for Actions, dependency downloads, and the explicitly allowlisted browser CDNs.

The run used a disposable local stack. It does not prove that the live production policies have been changed.

## Read-only production findings

1. PostgreSQL default ACLs owned by `postgres` grant broad table, sequence, and function privileges to `PUBLIC`, `anon`, and `authenticated`. These grants affect existing objects and future objects differently; a production migration must address both deliberately.
2. The current chat-media Storage policy checks conversation membership but does not bind the uploader folder segment in the object path to `auth.uid()`. The test-only overlay adds this guard and the Storage API test proves the denial case locally.
3. The deployed `app_private.get_or_create_direct_conversation_impl(uuid)` and `public.get_or_create_direct_conversation(uuid)` definitions were recovered read-only and match the test-only source fixture. The deployed SECURITY DEFINER implementation does not yet contain the tested active-membership and verified-member eligibility guard.
4. The current least-privilege overlay revokes default function EXECUTE privileges for future objects, but its existing-function revocation covers `PUBLIC` and `anon`, not `authenticated`. The current assertion also does not prove an allowlist for existing authenticated RPC execution. This must be resolved before calling the policy set least-privilege or promoting it.
5. Supabase Security Advisor reports Leaked Password Protection disabled. Enable the Auth setting before public release after reviewing the impact on password creation and changes. The advisor did not surface the custom ACL, direct-RPC eligibility, or Storage path-owner gaps found by catalog inspection.
6. Supabase Performance Advisor reports 27 unused indexes. Treat these as review candidates only; do not drop them until representative production query and workload evidence confirms they are unnecessary.

## Remaining blockers before production promotion

1. Build a reviewed canonical migration for the direct-conversation eligibility guard. Preserve the recovered production function behavior, add the approved caller/target eligibility checks, and test its exact ACL and SECURITY DEFINER search path.
2. Build a reviewed canonical Storage policy migration requiring the uploader path segment to equal `auth.uid()::text`, while preserving valid conversation-member reads and uploads.
3. Inventory every public RPC used by the client. Revoke unnecessary existing EXECUTE grants from `authenticated`, then grant only the verified allowlist. Add catalog assertions for `PUBLIC`, `anon`, and `authenticated`.
4. Review table and sequence grants against every client query and mutation before tightening existing-object privileges. The current CRUD/RPC tests are necessary but are not a complete feature inventory.
5. Resolve the canonical SQL bootstrap blockers: historical references to `public.messages` require an explicit legacy compatibility decision, and the historical membership-invitation SQL source has a terminator defect handled by a declared test-only patch. Do not silently remove or rewrite historical SQL without documenting the migration-history decision.
6. Re-run the complete disposable runtime and browser E2E after canonical migration candidates are added. Then run the concurrency and load suite again.
7. Review and enable Supabase Auth leaked-password protection before release; this is a project Auth setting, not a database migration.
8. Review the 27 unused-index advisories under representative workload; do not remove indexes based only on low or absent historical scans.

## Scope and safety

- This hardening work is restricted to the development branch and disposable local Supabase.
- No `supabase link`, remote migration, production SQL, production ACL change, merge, or deployment is authorized by these tests.
- The container egress guard isolates Supabase Docker networks; it does not disable the GitHub runner host's network access required by Actions and browser dependencies.
- The browser E2E currently covers the direct-message send/read/reload path. It does not yet certify every group, voice, attachment, reaction, membership-administration, or offline workflow.
- Overall status remains **BLOCKED** until the production-hardening candidates are canonicalized, reviewed, tested, and explicitly approved for promotion.
