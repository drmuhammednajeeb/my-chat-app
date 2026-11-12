# Environment Separation Contract

## Production browser runtime

- The GitHub Pages application uses the single approved Cloud Supabase project declared in `index.html`.
- The browser runtime must never contain a local endpoint such as `localhost`, `127.0.0.1`, `host.docker.internal`, or a local Supabase/Kong URL.
- The Cloud Supabase URL is intentionally pinned and covered by `tests/environment-separation.test.mjs`. Changing the target requires an explicit reviewed change to this contract and its test.
- The publishable/anon key is a browser key, not a service-role secret. Database access remains governed by Supabase Auth, RLS, RPC grants, and Storage policies.

## Local Supabase

- Local Supabase is not an application runtime and is not required to open or use the published website.
- The disposable runtime workflow creates a fresh Supabase project under the GitHub-hosted runner's temporary directory, runs isolated verification, and stops the stack even on failure.
- No local Supabase URL, key, Docker hostname, or local CLI configuration is injected into the GitHub Pages browser assets.
- Developers do not need Docker Desktop or a local Supabase stack to validate the browser source, message lifecycle, or voice-recording regression tests.

## SQL audit versus database runtime

- `.github/workflows/local-supabase-sql-audit.yml` is a source-only manifest audit. It inspects SQL files and explicitly reports `SQL_EXECUTION_AUTHORIZED=false`; it does not start Docker, reset a database, or connect to production.
- Runtime SQL/RLS checks, when intentionally invoked, run only against a disposable database created inside an isolated GitHub Actions runner.
- Neither workflow may target Supabase Production. Production schema, RLS, RPC, Storage, retention, and data changes require a separate approved migration/release process.

## Release invariant

A CI check fails if local-only endpoints appear in browser runtime assets or if the browser Supabase target changes without updating the reviewed production contract. A green local test is not evidence that Production was modified; a green browser test is not evidence of a production deployment.
