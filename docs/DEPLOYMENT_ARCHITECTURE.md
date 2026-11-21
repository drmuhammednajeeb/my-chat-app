# Deployment Architecture: GitHub Pages Primary, Vercel Standby

**Decision date:** 2026-11-21  
**Canonical production:** GitHub Pages — https://drmuhammednajeeb.github.io/my-chat-app/  
**Standby platform:** Vercel — recovery target only, not an independent application environment.

## 1. Platform roles

- GitHub Pages is the sole canonical production entry point and the platform used for release acceptance.
- Vercel is a standby target. It must not receive independent feature changes, independent database migrations, or a different production configuration.
- When Vercel standby is activated, both production targets must serve the same reviewed release and point to the same approved production Supabase project. This is continuity of service, not database replication.
- Only one platform is canonical at a time. Failover is an explicit owner-approved event with recorded start time, target URL, release SHA, and rollback decision.
- No Vercel deployment, project setting, domain, or environment variable is changed by this decision or this documentation PR.

## 2. Static runtime configuration (Pages-compatible)

PR #152 as written is incompatible with the primary platform: it adds a same-origin `/api/runtime-config` endpoint and relies on `VERCEL_ENV`, neither of which GitHub Pages provides.

The replacement design is a build-time generated static browser configuration file (for example `deployment-config.js`) loaded using a path relative to the application base. The build pipeline must:

1. Receive the Supabase project URL and publishable/anon key from a protected GitHub Actions Environment for the target deployment.
2. Validate the exact approved production project host for production artifacts and a separate allowlisted non-production project host for preview/test artifacts.
3. Reject service-role keys, `sb_secret_*` keys, legacy JWTs whose role is not exactly `anon`, malformed URLs, non-HTTPS cloud URLs, and local endpoints in deployed artifacts.
4. Generate the configuration file only inside the build workspace; never commit generated configuration to Git.
5. Verify the artifact contains only the public publishable/anon key, then upload it with its SHA-256 digest and release commit metadata.
6. Use relative asset and service-worker paths so the app works under the Pages project path and the Vercel root path. Verify manifest `start_url`, `scope`, and service-worker registration scope.

A Supabase publishable/anon key is intentionally browser-visible and is not an administrative secret. RLS, grants, RPC authorization, and Storage policies remain the security boundary. No service-role or secret key may enter the artifact.

## 3. Environment matrix

| Target | Hosting role | Supabase target | Release rule |
| --- | --- | --- | --- |
| GitHub Pages production | Primary | Approved production project only | Canonical release |
| Vercel production | Standby | Same approved production project only | Same immutable artifact/release; activate only during approved failover |
| Pull request / test | Non-production | Separate test Supabase project only | Never production credentials or production data |
| Local development | Developer workstation | Local or non-production project | Production host rejected |

Preview must fail closed when its non-production project is not explicitly allowlisted. Preview must never fall back to production credentials.

## 4. Artifact and deployment isolation

- Build once from a reviewed commit and promote the same immutable artifact to Pages and, when required, Vercel standby. Do not rebuild different source revisions for the two platforms.
- Keep separate GitHub Actions deployment jobs/environments: `production-pages` and `standby-vercel`. Give each job only the minimum deployment permission it needs.
- Pages is the only automatic production deployment path. Vercel standby deployment is manual/approval-gated and must not independently deploy every push to `main`.
- Preview/test jobs use a distinct environment and distinct test Supabase project. Do not reuse production configuration in preview.
- Never place Supabase service-role keys in GitHub Actions variables, Vercel variables, browser files, artifacts, logs, or build output.
- The service worker must remain same-origin and must never cache authenticated Supabase responses, messages, or private files.
- Deployment failure on one platform must not rewrite the other's settings or artifact.

## 5. Failover and recovery

1. Detect and record Pages outage or release failure using an independent availability check.
2. Confirm the standby artifact SHA equals the approved Pages release SHA and verify the Vercel origin serves the expected version and service-worker scope.
3. Obtain owner approval before activating Vercel as the temporary user-facing endpoint. DNS/domain changes, announcement, and link switching are separate authorized actions.
4. Verify authentication, two-user messaging, Realtime/polling recovery, uploads, Storage access, and RLS against the same production project.
5. Record activation time, reason, release SHA, validation evidence, and canonical URL change.
6. Restore Pages as canonical only after it is healthy and the owner approves switch-back.

Vercel standby is not a database backup and does not protect against Supabase outages, data corruption, compromised credentials, or shared-origin failures. Database backup/restore and Supabase recovery remain separate controls.

## 6. PR #152 disposition

Keep #152 Draft and do not merge it as-is. Its Vercel-specific `/api/runtime-config` endpoint and `VERCEL_ENV` contract conflict with GitHub Pages as primary. Retain its useful security requirements (strict environment validation, public-key-only exposure, preview isolation, fail-closed behavior, and tests), then port those requirements into the build-time static configuration design on a fresh branch based on current `main`.

Acceptance tests must prove:
- Production artifact points only to the approved production project.
- Preview artifact points only to an explicitly allowlisted non-production project.
- Missing, malformed, local, production-in-preview, service-role, and secret-key configurations fail the build.
- Both deployment origins serve the same release SHA and correct relative asset/service-worker paths.
- No generated configuration or secrets are committed or logged.
- Vercel standby cannot deploy automatically or diverge from the approved Pages artifact.

## 7. Explicit boundaries

This architecture decision does not authorize production Supabase SQL/migrations, Auth or Storage changes, cron changes, GitHub Pages settings changes, Vercel project/deployment/domain changes, repository visibility changes, or ruleset changes. Each requires its own reviewed change and explicit authorization.
