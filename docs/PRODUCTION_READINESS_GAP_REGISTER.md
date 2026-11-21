# Production Readiness Gap Register

**Review date:** 2026-11-21  
**Audited base:** `main` at `6dcb9e0dd18ee04b9afd61e477050c42a2e7a3bc` (PR #159)  
**Application release:** `2026.11.21.1`  
**Safety boundary:** No production Supabase data/schema/secrets, hosting settings, repository visibility, or rulesets were changed during this review.

## Executive status

The current source has successful recorded regression checks and disposable-local database verification. This does not establish that forward migrations are applied to production, that a real production backup has been restored, or that the deployed runtime matches every repository workflow.

No production database action is authorized by this register.

## Verified controls

- Active repository ruleset `main`, ID `27647211`.
- Branch deletion and non-fast-forward updates are blocked.
- Pull requests are required; stale approvals are dismissed; review threads must be resolved.
- Strict required checks: `regression`, `source-contract-regression`, `membership-number-format`, `read-only-sql-audit`, `local-supabase-runtime`.
- No bypass actors.
- Required approving review count is **0**; owner decision is still needed.
- #159 merge commit: `6dcb9e0dd18ee04b9afd61e477050c42a2e7a3bc`.
- Chat regression, Message lifecycle regression, and GitHub Pages deployment runs succeeded for the merge commit.
- Disposable local Supabase: run `44873724263`, commit `c87c871f4474a9f2bd99d6ce422c8e36cb6d578f`, 91 SQL sources executed in an isolated disposable stack; production was not accessed.
- Local SQL manifest audit: run `44873724159`, 107 passed, 0 failed.
- Release `2026.11.21.1`; Service Worker cache `v39`.

## Open gaps and required closure evidence

### G-01 — Forward migration reconciliation (critical)

The canonical registry contains 10 forward migrations, all recorded as `productionApplied: false`. Local replay success is not production application.

| Migration | Purpose | Recorded local state |
|---|---|---|
| `20261112160000_harden_direct_conversation_eligibility.sql` | Direct-conversation eligibility and RPC guards | Passed disposable replay |
| `20261112160001_harden_chat_media_upload_ownership.sql` | Chat media upload ownership | Passed disposable replay |
| `20261112160002_revoke_unsafe_public_default_privileges.sql` | Revoke unsafe public defaults | Passed locally; DAG-016 external review blocker |
| `20261112160003_enforce_active_membership_rls.sql` | Active-membership RLS | Passed locally; DAG-016 external review blocker |
| `20261113060002_fix_conversation_image_extension_validation.sql` | Image extension validation | Passed disposable replay |
| `20261117130000_message_auto_cleanup_100h_storage.sql` | 100-hour message/media cleanup | Passed disposable replay |
| `20261119113000_harden_privileged_rpc_active_membership.sql` | Privileged RPC membership guards | Passed disposable replay |
| `20261119120000_fix_conversation_avatar_public_channel_read.sql` | Conversation avatar visibility | Passed disposable replay |
| `20261119130000_increase_message_cleanup_http_timeout.sql` | Future cleanup HTTP timeout | Passed disposable replay |
| `20261121120000_enforce_signup_display_name_server_side.sql` | Server-side signup name validation | Passed disposable replay |

**Gate:** Recover exact production catalog state read-only; compare migration preconditions; validate ordering and mitigation/rollback; obtain separate explicit production authorization. Do not batch-apply.

### G-02 — Supabase-managed default ACL residual (critical)

DAG-016 remains an external platform review item. The registry says Supabase-managed `supabase_admin` defaults remain broad and cannot be changed by the application's `postgres` role. The recorded read-only production inspection found zero public relations/functions owned by `supabase_admin`, but the platform-level residual remains.

**Gate:** Obtain Supabase-level ACL review. Do not attempt to override Supabase-managed superuser defaults through application migrations.

### G-03 — Cleanup scheduler timeout and reconciliation (high)

The reviewed DAG records historical production observations: 274 HTTP 200 cleanup invocations in 24 hours, average around 3.2 seconds, maximum around 4.9 seconds, and three pg_net 5-second timeouts. The forward migration raises the timeout used for future scheduling to 10 seconds, but does not automatically reconfigure the active production cron job.

**Gate:** Read-only inspect the current cron definition and worker/queue outcomes; prepare a separately approved scheduler change if still needed. Verify Storage object deletion before deleting message rows. No scheduler change was made.

### G-04 — Deployment target and failover architecture (high)

Owner decision recorded on 2026-11-21: GitHub Pages is the canonical production platform at `https://drmuhammednajeeb.github.io/my-chat-app/`; Vercel is standby only. README and `docs/DEPLOYMENT_ARCHITECTURE.md` are aligned to this decision.

The prior audit showed a successful Pages deployment and a Vercel integration status. Those signals alone did not establish the canonical target; the owner has now designated Pages as primary.

**Gate:** Keep Pages as the only automatic production deployment path. Vercel must remain non-authoritative and approval-gated. Before standby activation, verify identical artifact SHA, version, service-worker scope, and production Supabase target. No hosting settings or deployment configuration were changed by this documentation decision.

### G-05 — Static runtime environment isolation (high)

PR #152's current design is not compatible with the primary GitHub Pages host as written: it requires a same-origin `/api/runtime-config` endpoint and `VERCEL_ENV`. GitHub Pages does not provide that serverless runtime.

**Approved design direction:** Generate a static `deployment-config.js` inside the build artifact using a protected GitHub Actions Environment. Validate the exact production Supabase host for production artifacts and an explicit non-production allowlist for preview/test artifacts. Reject service-role/secret keys, malformed URLs, local endpoints in deployed artifacts, and any production project in preview. Build once and promote the same immutable artifact to Pages and (only when needed) Vercel standby.

**Gate:** Keep #152 Draft and do not merge as-is. Port its valuable key validation, fail-closed behavior, and environment-isolation tests to the static build-time configuration design on a fresh branch. Verify relative asset paths, manifest scope, and Service Worker scope on both Pages project-path and Vercel root-path origins. Only public publishable/anon credentials may enter browser artifacts. No production variables, secrets, hosting settings, or Supabase state were changed.

### G-06 — Voice duration not yet in mainline (medium)

PR #141 remains open and contains the `attachment_duration_seconds` migration and audio-duration persistence changes alongside a broad message-render/loading refactor. This migration is not among the 10 canonical forward migrations and is not covered by #159 mainline runtime evidence.

**Gate:** Do not merge the old branch as-is. Extract the minimum voice-duration change onto a fresh branch from current `main`, register it in the migration registry/DAG, replay locally, and test old/new message compatibility.

### G-07 — Backup and restore proof (high)

The Encrypted Backup Restore Validation workflow and #159 PR checks passed. This is test evidence, not proof that a real production backup can be restored with messages, metadata, and Storage objects intact.

**Gate:** Conduct a controlled restore drill to an isolated destination using a real encrypted backup; verify record counts, attachments, key recovery, and documented RPO/RTO. Never restore over production.

### G-08 — Human approval policy (medium)

The active ruleset requires checks and review-thread resolution but currently requires zero approving reviews.

**Gate:** Owner to decide whether at least one independent approval is required. Any ruleset change requires owner/admin authorization and validation of required check names. No ruleset setting was changed.

### G-09 — Public repository exposure review (medium)

GitHub API reports `private: false`. Public visibility may be intentional for Pages, but all committed source and history are public.

**Gate:** Scan current files and repository history for secrets, private test data, personal data, and internal endpoints. Rotate any exposed secret at its provider; deleting a file alone is insufficient. Do not change visibility without confirming the Pages impact and owner intent.

## Open PR disposition

- **#141:** Keep open but do not merge as-is; extract voice-duration work after mainline replay and compatibility tests.
- **#152:** Keep Draft; do not merge until hosting target and runtime-config architecture are settled.
- Older open PRs may overlap completed work; triage each against current `main` before merge or closure. This register does not close them.

## Release gate for every future change

1. Branch from current `main`; never push feature work directly to `main`.
2. Preserve the active ruleset and required CI checks.
3. For database changes, update the canonical registry, dependency DAG, replay manifest, and mitigation notes in the same PR.
4. Require disposable local Supabase replay and SQL audit evidence for migration changes.
5. Use independent test users and least-privilege Storage/RLS probes where applicable.
6. Verify Preview/Production target isolation before deployment.
7. Verify deployed URL, release version, and Service Worker cache after deployment.
8. Never equate green CI with production migration or successful production backup recovery.

## Explicitly not done

- No production SQL or migrations executed.
- No production records, Auth users, Storage objects, Cron jobs, Edge Functions, or secrets changed.
- No hosting settings, repository visibility, or ruleset settings changed.
- No open PR merged or closed by this review.
