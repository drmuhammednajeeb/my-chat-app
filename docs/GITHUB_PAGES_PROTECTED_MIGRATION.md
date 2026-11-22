# GitHub Pages Protected Production Migration Runbook

**Prepared:** 2026-11-22  
**Target:** GitHub Pages as canonical production; Vercel remains approval-gated standby.  
**Safety state:** Preparation only. This runbook and its artifact builder do not deploy, change Pages settings, alter DNS, or modify Supabase.

## 1. Findings from the repository review

- The policy documented in PR #160 designates GitHub Pages as canonical production and Vercel as standby.
- The current \`main\` README still describes Vercel as canonical production and explicitly says GitHub Pages is not the production path. This must be reconciled before the cutover.
- The current \`main\` application embeds the Supabase URL and browser publishable key directly in \`index.html\`.
- PR #161 moves the browser client to \`deployment-config.js\` plus \`modules/runtime-config.js\`, and pins production to the approved Supabase project. Its checked-in config is a compatibility source file, not yet a protected Pages build pipeline.
- The repository's current \`.github/workflows\` tree has no GitHub Pages build/deploy workflow. The repository Pages settings/source mode could not be independently verified through the available read-only GitHub connection. Do not assume whether Pages currently deploys from a branch or Actions.
- PR #161 already makes Vercel fail closed when required environment values or explicit standby approval are absent. This is independent of Pages activation.

## 2. What this preparation adds

- \`scripts/build-pages.mjs\` creates a clean static artifact under \`dist/pages-static\`.
- The builder excludes the checked-in \`deployment-config.js\`, source-only folders, Vercel configuration, and \`.env\` files.
- It generates a fresh \`pages-production\` configuration inside the output only, using the shared strict validator.
- It verifies the approved production Supabase host, public-key-only contract, relative PWA manifest scope, runtime config load order, Service Worker network-only config fetch, and release commit provenance.
- \`.github/workflows/pages-production-artifact.yml\` runs contract tests on PRs and prepares a review-only candidate only when manually dispatched from \`main\` with explicit confirmation and the \`production-pages\` GitHub Environment.
- The workflow uploads a short-lived review artifact. It intentionally has no \`deploy-pages\` step, no \`pages: write\` permission, and no \`id-token: write\` permission.

## 3. Required GitHub Environment setup (owner action)

Before manually preparing a production candidate, create the GitHub Actions Environment named exactly:

\`production-pages\`

Configure it with:
- Required reviewer(s): at least one trusted owner/reviewer.
- Deployment branch restriction: \`main\` only.
- Environment variable \`PAGES_PRODUCTION_SUPABASE_URL\`: the exact approved production Supabase project URL.
- Environment secret \`PAGES_PRODUCTION_SUPABASE_ANON_KEY\`: the existing browser-safe publishable/anon key only.

Never enter a service-role key, \`sb_secret_*\`, database password, or administrative credential. The publishable/anon key is intentionally browser-visible; it is placed in an Environment secret only to control which reviewed build receives it and to avoid printing it in logs.

Do not create a Preview deployment environment until a separate non-production Supabase project exists. Local disposable Supabase is CI-only and must not be exposed as a hosted Preview backend.

## 4. Candidate build procedure

1. Merge the reviewed runtime-config and Pages artifact-builder code only after all required checks pass.
2. Verify the \`production-pages\` Environment and its reviewer/branch protections in GitHub Settings.
3. Open Actions → Pages production artifact preparation.
4. Select \`main\`, run manually, and enter \`BUILD-PAGES-ARTIFACT\`.
5. Approve the Environment deployment gate when GitHub requests it.
6. Download the review-only artifact and record its source commit, \`release-metadata.json\`, and SHA-256 digest.
7. Inspect the artifact before any deployment. Confirm it contains the expected static app, generated \`deployment-config.js\`, no checked-in config, no \`.env\`, no service-role/secret key, and no source-only folders.

The workflow does not publish the candidate. Artifact creation is not a production deployment.

## 5. Cutover gates (separate owner approval required)

Do not switch the GitHub Pages source setting until all gates below are evidenced:

- [ ] Confirm the live production URL and current Pages source mode in repository Settings → Pages.
- [ ] Reconcile \`README.md\`, PR #160 policy, PR #161 runtime configuration, and the actual hosting settings so they all identify the same canonical production platform.
- [ ] Confirm the current production app is healthy and preserve the last known-good source commit and release artifact for rollback.
- [ ] Confirm the production Environment has required reviewers and \`main\`-only deployment restrictions.
- [ ] Build the candidate from the exact reviewed \`main\` commit and inspect its contents and SHA-256.
- [ ] Run static smoke checks against the candidate under the project path \`/my-chat-app/\`, including relative assets, manifest scope, and Service Worker scope.
- [ ] Obtain explicit owner approval for the Pages source-setting change and for adding a deployment job with \`pages: write\` and \`id-token: write\`.
- [ ] Only then add/enable the deployment job using the reviewed artifact; do not rebuild a different source revision during deployment.
- [ ] Verify the live URL, version, authentication, two-user messaging, Realtime recovery, uploads, Storage authorization, and PWA update behavior.
- [ ] Keep Vercel standby disabled until a separate explicit activation approval; it must serve the same approved release artifact and production Supabase target.

## 6. Rollback

- Preserve the last known-good release commit, artifact, and current Pages source configuration before cutover.
- If the new artifact fails pre-deployment checks, do not deploy it.
- If the deployed Pages release fails acceptance, stop further rollout and restore the last known-good reviewed artifact through the approved Pages deployment process.
- Do not switch to Vercel automatically. Standby activation, DNS/domain changes, and user-facing URL changes each require separate owner approval.

## 7. Explicit non-actions

This preparation does not:
- change GitHub Pages source settings or repository environments;
- create or modify GitHub secrets/variables;
- deploy to Pages or Vercel;
- merge PR #160 or PR #161;
- modify Supabase Auth, RLS, Storage, SQL, migrations, or production data;
- change DNS, domains, repository visibility, or rulesets.
