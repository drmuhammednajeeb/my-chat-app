# Security & Quality Audit — Backup & Restore

## Scope and safety boundary

- Audit branch: `fix/security-quality-audit-backup-restore`
- Starting point: `feature/portable-project-backup`
- Scope: `modules/backup.js`, its documented recovery behavior, and read-only inspection of the connected Supabase project.
- No changes were made to `main`, PR #72, PR #73, Supabase schema, RLS policies, Storage policies, production records, or hosting configuration.
- This is a source/configuration audit plus static validation. It is not a claim of a full authenticated end-to-end restore test.

## Changes applied

1. Replaced wildcard projections in personal-data exports with explicit field allowlists. Shared archive exports now also use explicit projections based on the live schema.
2. Removed the unused generic conversation-fetch helper that performed an unrestricted `select('*')`.
3. Fixed schema-v2 validation so a legitimately absent profile row (`profile: null`) is accepted, while a non-null profile must belong to the signed-in user.
4. Hardened attachment validation:
   - Reject absolute, empty, traversal, malformed-encoding, and backslash-containing storage paths.
   - Require chat-media and conversation-document paths to begin with the matching conversation ID and current user ID.
   - Require profile-avatar paths to belong to the current user.
   - Validate base64 shape and encoded length against the declared byte size before decoding.
   - Re-check document ownership, conversation, and exact storage path against archived metadata before inserting a missing document row.
5. Removed channel-avatar binary downloads from new personal backups. Channel avatars are shared conversation assets; their path metadata remains in the conversation archive, but the binary objects are not duplicated or restored as personal files.
6. Clarified that notifications are exported as a read-only archive section and are not reinserted during restore. This avoids recreating stale notification events or assuming that notification foreign-key references still exist.
7. Kept restore merge-only: no delete/truncate path was introduced. The UI warns that a failure can occur after earlier sections have succeeded.

## Supabase read-only findings

The connected project was inspected without making writes.

- All 24 tables in the `public` schema reported RLS enabled.
- The reviewed user-owned tables use authenticated ownership predicates tied to `auth.uid()`; conversation-scoped data additionally checks active membership.
- The `chat-media` and `conversation-documents` buckets are private. Their Storage policies constrain access by conversation membership and/or owner path.
- The `channel-avatars` bucket is private and has channel-admin upload/update/delete and member-access read policies.
- The `avatars` bucket is public for public avatar delivery; object upload/update/delete policies constrain the owner path. Public delivery means the object URL itself is not private.
- Supabase Security Advisor returned one warning: leaked-password protection is disabled. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

No database or policy remediation was applied because it is outside this branch's scope and would require a separate approval.

## Static validation performed

- JavaScript syntax compilation of the updated `modules/backup.js`: PASS.
- Personal export allowlist checks: PASS.
- Explicit notification and shared-archive projections: PASS.
- Nullable-profile validation check: PASS.
- Safe storage-path and base64-size validation checks: PASS.
- New-export exclusion of shared channel-avatar binaries: PASS.
- No destructive delete/truncate statements in the restore module: PASS.

## Known behavior and residual test requirements

- Restore is not a single database transaction across multiple PostgREST/Storage requests. If a later section fails, earlier successful sections remain. The UI reports this possibility; the restore operations are designed to be merge-oriented and retryable, but this must still be exercised in an isolated test project.
- Notifications remain inside the encrypted backup for reference but are not restored.
- Shared channel-avatar binaries are not included in new personal backups. They remain shared cloud assets and require a separate Storage disaster-recovery procedure.
- Conversations, messages, reactions, pins, membership metadata, and related shared context are archived for reference; they are not recreated by the account-level restore.
- A real authenticated export/restore test, cross-account rejection test, tamper test, wrong-password test, malformed-path test, and injected mid-restore failure test remain required before production approval.
- The PowerShell backup workflow was previously run successfully by the project owner on Windows. The audit did not independently execute PowerShell in this environment.

## Release decision

**Do not merge or deploy from this branch yet.** First run the isolated authenticated test matrix above and review the resulting behavior. Keep PR #72, PR #73, `main`, and production Supabase unchanged until a separate explicit approval.
