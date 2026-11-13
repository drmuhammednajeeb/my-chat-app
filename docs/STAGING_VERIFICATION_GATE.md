# Staging Verification Gate

**Current state: BLOCKED for hosted Supabase E2E.** The repository has passed a disposable-local Supabase migration replay, but no hosted two-account Auth/Realtime/Storage test has been run.

## Safety constraints

- The production Supabase host `lvkeohpuucuklagvwpnq.supabase.co` is explicitly rejected by the staging preflight.
- The preflight performs local URL/configuration checks only. It makes no HTTP, Auth, database, Realtime, or Storage requests.
- No migrations, schema changes, RLS changes, Storage changes, or production settings are performed by this staging gate.
- No credentials are stored in the repository. GitHub Actions secrets are read only when an operator configures them.
- Two distinct, dedicated test identities are required. Never reuse personal or production accounts.
- Do not configure secrets until a separate, free, isolated Supabase project exists and its owner has confirmed that it contains no production data.
- No paid Supabase project, paid development branch, upgrade, or usage-generating resource is authorized.

## GitHub Actions secrets required later

| Secret | Purpose |
|---|---|
| `STAGING_SUPABASE_URL` | HTTPS origin of the isolated Supabase project |
| `STAGING_SUPABASE_ANON_KEY` | Public/anon client key for that isolated project |
| `STAGING_TEST_USER_EMAIL` / `STAGING_TEST_USER_PASSWORD` | Dedicated sender test account |
| `STAGING_TEST_PEER_EMAIL` / `STAGING_TEST_PEER_PASSWORD` | Different dedicated receiver test account |

Never paste secret values into issues, commits, logs, or chat. Configure them only in the repository's GitHub Actions Secrets interface after the isolated project is independently verified.

## Workflow behavior

Run **Staging E2E readiness gate** manually from GitHub Actions.

- No secrets: `VALIDATION_ONLY`; local validation and simulations run, no backend test runs.
- Partial secrets: fail closed.
- Production host, insecure URL, URL with embedded credentials/path/query/fragment, or duplicate test identity: fail closed.
- Complete isolated configuration: `CONFIGURED_NOT_EXECUTED`. This is intentionally not a green E2E result; a full-app staging runner still needs to be implemented and reviewed before any backend request is permitted.

## Disposable local Supabase rehearsal (separate from hosted staging)

The **Disposable local Supabase runtime verification** workflow completed successfully on reviewed commit `883ebb0a7c74d64ad6334b67410bf95267d43535` (workflow run #684 / run ID `43376102024`):

- It created an isolated temporary Supabase project.
- It started the disposable Supabase stack and executed the reviewed migration replay.
- The replay step completed successfully.
- The workflow stopped and destroyed the disposable stack successfully.

This is valid evidence for the reviewed local replay, including the forward migration source selected by the replay manifest. It is not evidence that migrations were applied to production or that hosted E2E passed.

Separate loopback-only/manual probes remain distinct and must not be described as executed merely because the replay workflow passed:

- `tests/staging/local-supabase/local-pg-cron-runtime.mjs` is a separate scheduler probe. It schedules a uniquely named `SELECT 1` job, waits up to 90 seconds for a successful run, then unschedules it and removes only its own run details. Its independent scheduler execution has not been verified.
- `tests/staging/local-supabase/direct-conversation-concurrency.mjs` is a separate two-session reversed-pair test. It accepts only a disposable loopback PostgreSQL endpoint on port 54322 and refuses cloud targets. Its independent concurrency run has not been verified.
- `tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs` is a separate manual runner for the least-privilege overlay. Its independent execution has not been verified.
- The hosted staging readiness preflight is configuration-only and does not contact Supabase.

## Test classification

| Test | Classification | Current meaning |
|---|---|---|
| Repository source/DAG/fixture audits | Passed in GitHub Actions | Static validation of repository sources |
| Disposable local Supabase migration replay | Passed, run #684 | Real isolated local PostgreSQL/Supabase replay and cleanup |
| Message lifecycle regression | Passed in GitHub Actions | Browser and fake-Supabase regression; not hosted E2E |
| Encrypted backup/restore workflow | Passed | Synthetic workflow validation; not a production-data restore |
| Hosted staging preflight | Configuration-only | No HTTP/Auth/database/Realtime/Storage requests |
| Independent pg_cron scheduler probe | Not independently verified | Job catalog definition alone is insufficient |
| Two-session reversed-pair concurrency | Not independently verified | Separate real PostgreSQL runner; loopback-only guard |
| Standalone least-privilege runtime runner | Not independently verified | Separate loopback-only runner |
| Hosted Auth, Realtime, Storage, RLS E2E | Blocked / not run | Requires a separate isolated backend and reviewed runner |
| Real load test | Not run | Requires isolated backend and explicit resource budget |

## Acceptance sequence

1. Obtain a separate free isolated backend without deleting or repurposing either existing Supabase project.
2. Confirm the project ref/host is distinct from production and contains no production data.
3. Create two dedicated test identities with only the permissions needed for tests.
4. Implement and review a narrowly scoped full-app runner. Restrict all destructive cleanup to records owned by the test identities and a unique test-run marker.
5. Run two-account direct-chat and group/channel scenarios, Realtime reconnect, attachment upload/signed URL, retry/idempotency, edits/deletes, and unauthorized third-party access checks.
6. Only after those pass, design a separate bounded concurrency test with explicit request rate, duration, and cleanup rules.

**No capacity, production readiness, or real-backend E2E claim may be made from the simulations or preflight.**

## RLS and least-privilege hardening

The production catalog was inspected read-only. RLS was enabled on the application tables examined, but the `postgres` default ACL for the `public` schema granted broad table, sequence, and function privileges to API roles. Existing tables therefore had non-RLS privileges that must be removed independently of row policies.

A test-only least-privilege overlay is prepared in `tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql`. It removes unsafe API-role/default ACL grants and adds a restrictive active-membership policy to every postgres-owned public application table and `storage.objects`, while preserving feature-specific policies. Read-only postconditions are in `rls-least-privilege.assert.sql`. The manual runner `tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs` accepts only `postgres@loopback:54322/postgres`; its independent execution has not been verified. The overlay is sequenced last and is not a production migration. See `docs/RLS_LEAST_PRIVILEGE_HARDENING.md` for live catalog findings and the required runtime matrix.

## Additional security regression — conversation image suffix validation

The live PostgreSQL probe found that the historical conversation-image regex did not match normal `.jpg` suffixes under `standard_conforming_strings=on`. The forward migration `20261113060002_fix_conversation_image_extension_validation.sql` and its post-forward assertion are registered in the source registry, replay manifest, and dependency DAG. The migration was included in the reviewed disposable-local replay, which completed successfully on run #684. It remains unapplied to production and still requires the separate production backup, approval, and controlled-release gates.
