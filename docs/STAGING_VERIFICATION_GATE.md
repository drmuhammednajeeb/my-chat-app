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

## Test classification

| Test | Classification | Current meaning |
|---|---|---|
| Existing 10 source-contract checks | Passed in prior recorded CI run | Static source contracts only |
| Existing 7 Chromium function-level checks | Passed in prior recorded CI run | Actual extracted functions with DOM/fake Supabase |
| Staging preflight | Prepared; CI execution pending | Configuration guard only |
| Fake concurrency scenarios | Simulation only; CI execution pending | In-memory deterministic model, not backend load |
| Authenticated two-account E2E | Blocked / not run | Requires free isolated project and reviewed runner |
| Realtime, Storage, RLS verification | Not run | Requires isolated backend |
| Real concurrent-user / load test | Not run | Requires isolated backend and explicit resource budget |

## Acceptance sequence

1. Obtain a separate free isolated backend without deleting or repurposing either existing Supabase project.
2. Confirm the project ref/host is distinct from production and contains no production data.
3. Create two dedicated test identities with only the permissions needed for tests.
4. Implement and review a narrowly scoped full-app runner. Restrict all destructive cleanup to records owned by the test identities and a unique test-run marker.
5. Run two-account direct-chat and group/channel scenarios, Realtime reconnect, attachment upload/signed URL, retry/idempotency, edits/deletes, and unauthorized third-party access checks.
6. Only after those pass, design a separate bounded concurrency test with explicit request rate, duration, and cleanup rules.

**No capacity, production readiness, or real-backend E2E claim may be made from the simulations or preflight.**
