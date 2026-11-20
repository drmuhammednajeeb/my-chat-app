# Environment Separation Contract

## Production browser runtime

- **Vercel is the approved production host** for the application. The repository `main` branch is the production source; GitHub Pages is not an approved deployment target for the current runtime architecture.
- The browser obtains its Supabase URL and publishable key from the same-origin `/api/runtime-config` endpoint. Do not reintroduce hardcoded Supabase project URLs or keys into `index.html` or other browser assets.
- Vercel Production must resolve only to the approved project `lvkeohpuucuklagvwpnq`. The runtime endpoint rejects any other production host.
- The publishable/anon key is a browser key, not a service-role secret. Database access remains governed by Supabase Auth, RLS, RPC grants, and Storage policies.
- Vercel Preview must use a separate non-production Supabase project. The runtime endpoint requires an exact `SUPABASE_PREVIEW_ALLOWED_HOST` match and rejects the production project.
- Vercel Development may use localhost/127.0.0.1 or a non-production cloud project, but must reject the production project.
- The runtime endpoint fails closed when required variables are missing or invalid. Never place service-role keys, Supabase secret keys, or other administrative credentials in browser configuration.

## Vercel environment variables

- Production: `SUPABASE_URL` and `SUPABASE_ANON_KEY` must identify the approved production project and its publishable key.
- Preview: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and exact `SUPABASE_PREVIEW_ALLOWED_HOST` must identify a separate test project.
- Development: use local credentials or a non-production project only.
- These values are managed in Vercel Project Settings and must be verified by the project owner. CI success and a Ready Preview deployment do not prove that the live environment variables are correctly configured.

## GitHub Pages compatibility

- GitHub Pages is not the production host for the current Vercel runtime-config architecture because it does not provide the same-origin `/api/runtime-config` serverless endpoint.
- Do not deploy the Vercel runtime-config branch to GitHub Pages and assume the application will initialize. If a Pages deployment is required in the future, it needs a separately designed, explicit public configuration mechanism and its own environment-isolation tests; do not weaken the Vercel runtime contract to make Pages work.
- Historical Pages URLs or workflow runs are not evidence that the current production deployment is served by Pages.

## Local Supabase and disposable runtime

- Local Supabase is a development/test runtime only; it is not the published application runtime.
- The disposable runtime workflow creates a fresh Supabase project under the GitHub-hosted runner's temporary directory, runs isolated verification, and stops the stack even on failure.
- No local Supabase URL, key, Docker hostname, or local CLI configuration is injected into deployed browser assets.
- Developers do not need Docker Desktop or a local Supabase stack to validate browser source-contract tests. Runtime SQL/RLS checks, when intentionally invoked, run only against a disposable database created inside an isolated GitHub Actions runner.

## SQL audit versus database runtime

- `.github/workflows/local-supabase-sql-audit.yml` is a source-only manifest audit. It inspects SQL files and explicitly reports `SQL_EXECUTION_AUTHORIZED=false`; it does not start Docker, reset a database, or connect to production.
- Runtime SQL/RLS checks, when intentionally invoked, run only against a disposable database created inside an isolated GitHub Actions runner.
- Neither workflow may target Supabase Production. Production schema, RLS, RPC, Storage, retention, and data changes require a separate approved migration/release process.

## Release invariant

A CI check fails if local-only endpoints appear in browser runtime assets or if the browser Supabase target changes without updating the reviewed production contract. A green local test is not evidence that Production was modified; a green browser test or Ready Preview is not evidence of a verified Production deployment. Production and Preview environment variables must be checked in Vercel before this configuration change is merged.
