# Static Runtime Configuration and Environment Isolation

## Purpose
Keep the browser application independent of hosting-provider server APIs. GitHub Pages and the Vercel standby consume the same static configuration contract; the build target determines which Supabase project is permitted.

## Runtime contract
- `deployment-config.js` defines `window.__BIZMIND_DEPLOYMENT_CONFIG__` and is loaded before the Supabase client and application bootstrap.
- `modules/runtime-config.js` validates target, HTTPS project origin, explicit expected host, and browser-safe key before the client is initialized.
- Only a Supabase publishable key (`sb_publishable_*`) or anon-role JWT is accepted. Secret and service-role keys are rejected.
- Production targets (`pages-production`, `vercel-standby`) are pinned to `lvkeohpuucuklagvwpnq.supabase.co`.
- Preview/test targets require `BIZMIND_NONPROD_SUPABASE_HOST` and reject the production host.
- `scripts/generate-deployment-config.mjs` writes the static file from environment variables. Missing or invalid inputs fail closed; no fallback project is permitted.

## Build inputs

| Variable | Production targets | Preview/test |
| --- | --- | --- |
| `BIZMIND_DEPLOYMENT_TARGET` | `pages-production` or `vercel-standby` | `preview` or `test` |
| `SUPABASE_URL` | Approved production project origin | Explicit non-production project origin |
| `SUPABASE_ANON_KEY` | Public publishable/anon key only | Public publishable/anon key only |
| `BIZMIND_NONPROD_SUPABASE_HOST` | Not used | Required exact host allowlist |

The checked-in `deployment-config.js` is the current public Pages production configuration so the existing static hosting path remains operational while deployment workflows are reviewed separately. It contains no privileged credential. The generator replaces this file in an isolated build workspace for each target.

## Deployment integration gate
This change introduces and tests the configuration contract and generator. It does **not** reconfigure GitHub Pages' repository-level build source or Vercel project build settings, and does not claim preview builds are already isolated. Before enabling generated per-target artifacts, the owner-approved deployment pipelines must invoke the generator with protected environment-scoped variables, publish the generated artifact, and prove both platforms serve the same release SHA. Until then, the checked-in config remains pinned to the primary production project.

Never add Supabase service-role or `sb_secret_*` values to browser artifacts, GitHub Actions logs, committed files, or frontend build variables. Public publishable/anon keys are browser-visible by design; authorization remains enforced by Supabase RLS, grants, RPC checks, and Storage policies.
