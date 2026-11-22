# Static Runtime Configuration and Environment Isolation

## Purpose
Keep the browser application independent of hosting-provider runtime APIs. GitHub Pages remains the canonical production platform; Vercel is a standby target and must not become an independent release stream.

## Runtime contract
- `deployment-config.js` defines `window.__BIZMIND_DEPLOYMENT_CONFIG__` and is loaded before the Supabase client and application bootstrap.
- `modules/runtime-config.js` validates the target, HTTPS project origin, exact project-host allowlist, and browser-safe key before the client is initialized.
- Only a correctly shaped Supabase publishable key (`sb_publishable_*`) or a structurally valid anon-role JWT is accepted. Secret and service-role keys are rejected.
- Production targets (`pages-production`, `vercel-standby`) are pinned to `lvkeohpuucuklagvwpnq.supabase.co`.
- Preview/test targets require `BIZMIND_NONPROD_SUPABASE_HOST` and reject the production host.
- The generator fails closed when inputs are missing or invalid; it never selects a fallback project.

## Build inputs

| Variable | Production targets | Preview/test |
| --- | --- | --- |
| `BIZMIND_DEPLOYMENT_TARGET` | `pages-production` or `vercel-standby` | `preview` or `test` |
| `SUPABASE_URL` | Approved production project origin | Explicit non-production project origin |
| `SUPABASE_ANON_KEY` | Public publishable/anon key only | Public publishable/anon key only |
| `BIZMIND_NONPROD_SUPABASE_HOST` | Not used | Required exact host allowlist |

The checked-in `deployment-config.js` remains the public production configuration consumed by the current GitHub Pages source. It contains only the browser-safe publishable key. A future Pages artifact migration must generate this file inside a protected build artifact before removing the compatibility file; changing Pages repository settings is a separate approved operation.

## Vercel build isolation

- `vercel.json` routes Vercel through `scripts/build-vercel.mjs`; the builder excludes the checked-in production configuration and creates a fresh output-only configuration.
- Vercel Preview requires a separate non-production `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and exact `BIZMIND_NONPROD_SUPABASE_HOST` configured for the Preview environment. Missing values intentionally fail the build; there is no fallback to the checked-in production file.
- Vercel Production is the standby target only. It fails unless `BIZMIND_VERCEL_STANDBY_APPROVED=true` and `BIZMIND_STANDBY_RELEASE_SHA` exactly matches `VERCEL_GIT_COMMIT_SHA`. This pins an explicitly approved deployment to one commit rather than enabling a free-running release stream.
- The current connected Vercel project has no environment variables configured. Consequently, its Preview and Production builds will fail closed until the owner separately provisions the appropriate environment values. No Vercel settings or variables were changed by this code change.
- The Vercel response for `deployment-config.js` is marked `no-store`. On both hosting platforms the Service Worker fetches this file network-only with `cache: no-store`, never precaches it, and returns an unavailable response rather than serving stale configuration offline.

## Verification and release boundaries

- `tests/runtime-config.test.mjs` covers production pinning, non-production allowlisting, malformed URLs, invalid keys, and missing inputs.
- `tests/runtime-config-deployment.test.mjs` exercises Vercel Preview/standby gates and verifies the generated static output excludes the checked-in production configuration and non-runtime files.
- `.github/workflows/runtime-config-isolation.yml` runs the isolated configuration regression tests without production credentials or network access.
- This change does not deploy Pages or activate Vercel standby. It does not change Supabase Auth, RLS, Storage, SQL, migrations, or production data.

Never add Supabase service-role or `sb_secret_*` values to browser artifacts, GitHub Actions logs, committed files, Vercel environment variables, or frontend build output. Public publishable/anon keys are browser-visible by design; authorization remains enforced by Supabase RLS, grants, RPC checks, and Storage policies.
