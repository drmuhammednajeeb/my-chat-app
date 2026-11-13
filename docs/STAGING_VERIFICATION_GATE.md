# Staging Verification Gate

**Current state: BLOCKED for real Supabase E2E.** This change prepares a fail-closed gate; it does not provision infrastructure or execute authenticated backend tests.

## Safety constraints

- The production Supabase host `lvkeohpuucuklagvwpnq.supabase.co` is explicitly rejected.
- The preflight performs local URL/configuration checks only. It makes no HTTP, Auth, database, Realtime, or Storage requests.
- No migrations, schema changes, RLS changes, Storage changes, or production settings are performed.
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

A local-only catalog gate is now prepared:

- `tests/staging/local-supabase/fixtures/local-platform-prerequisites.assert.sql` must run immediately after the disposable local stack starts and before application SQL. It is read-only and verifies Auth/Storage/Realtime schemas and objects, required roles, the Realtime publication, pgcrypto's required `extensions` placement, and pg_cron availability.
- `tests/staging/local-supabase/fixtures/local-platform-postconditions.assert.sql` must run after the workspace and expiry-purge nodes. It verifies pgcrypto function resolution and the expected `cron.job` definition. It does not prove that the scheduler actually executed the job.
- `tests/staging/local-supabase/local-pg-cron-runtime.mjs` is a separate loopback-only runtime probe. It schedules a uniquely named `SELECT 1` job, waits up to 90 seconds for a successful run, then unschedules it and removes only its own run details. It has not been executed.
- Synthetic direct-chat Auth identities are created before membership triggers; Profiles are created after the membership profile guard. The runtime SQL fixture promotes eligible synthetic identities through the real local admin RPCs and ends in `ROLLBACK`.
- `tests/staging/local-supabase/direct-conversation-concurrency.mjs` is a separate two-session reversed-pair test. It accepts only a disposable loopback PostgreSQL endpoint on port 54322 and refuses cloud targets.

**Execution remains disabled.** Neither catalog assertion, runtime SQL fixture, concurrency runner, pg_cron probe, nor Supabase local stack has been executed. These files are test preparation, not runtime evidence.

## Test classification

| Test | Classification | Current meaning |
|---|---|---|
| Repository source/DAG/fixture audits | Executed by GitHub Actions | Static validation; no PostgreSQL was contacted |
| Browser/message lifecycle regression | Executed by GitHub Actions | Browser and fake-Supabase regression; not hosted E2E |
| Hosted staging preflight | Configuration-only | No HTTP/Auth/database/Realtime/Storage requests |
| Local platform preflight/postflight SQL | Prepared; not executed | Read-only catalog assertions for local Supabase only |
| Direct-conversation PostgreSQL runtime SQL | Prepared; not executed | Rollback-only behavior, eligibility, reuse and ACL assertions |
| Two-session reversed-pair concurrency | Prepared; not executed | Real PostgreSQL test runner; loopback-only guard |
| pg_cron scheduler execution | Not verified | Job catalog definition alone is insufficient |
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

A test-only least-privilege overlay is prepared in `tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql`. It removes unsafe API-role/default ACL grants and adds a restrictive active-membership policy to every postgres-owned public application table and `storage.objects`, while preserving feature-specific policies. Read-only postconditions are in `rls-least-privilege.assert.sql`. The manual runner `tests/staging/local-supabase/local-rls-least-privilege-runtime.mjs` accepts only `postgres@loopback:54322/postgres` and is syntax-checked by CI; it has **not** been executed. The overlay is sequenced last and is not a production migration. See `docs/RLS_LEAST_PRIVILEGE_HARDENING.md` for live catalog findings and the required runtime matrix.

## Additional security regression — conversation image suffix validation

The live PostgreSQL probe found that the historical conversation-image regex did not match normal `.jpg` suffixes under `standard_conforming_strings=on`. A forward migration `20261113060002_fix_conversation_image_extension_validation.sql` and an assertion in `forward-hardening-postconditions.assert.sql` now cover this. The migration is registered in the source registry, replay manifest and dependency DAG. Its fresh disposable-local runtime replay is pending; do not report it as passed or apply it to production until the new workflow run succeeds.
