# Architecture Risk Audit — 2026-11-26

**Audit base:** main after PR #188, commit `9537d9a311e96d5d15bc71a75893d143a7a43ba0`  
**Scope:** source-level architecture, dependency contracts, PWA asset lifecycle, extracted-module coupling, deployment/configuration risks.  
**Mode:** read-only review. No runtime, production DB, Auth, Storage, deployment, or application code changed.

## Executive result

The codebase has made meaningful progress extracting feature modules, but the central controller in `index.html` remains the dominant architectural risk. Several extracted modules still consume mutable globals (`state`, `supabaseClient`, `toast`) rather than explicit, stable contracts. The next engineering phase should be dependency-boundary hardening and regression harness expansion—not a large rewrite.

This review is a source-level risk audit, not a complete AST call graph or live deployment verification. Findings below are evidence-grounded observations; priorities are engineering triage.

## Findings

### A-01 — Main controller remains a high-blast-radius monolith
**Priority: P1 — address progressively**

The page still contains a large inline controller alongside markup and boot logic. The ending of the page includes a long feature implementation block for conversation workspace, notes, documents and private-reply context, followed by direct script wiring. Features remain coupled to DOM IDs, the active conversation, shared mutable state and the Supabase client.

**Risk:** a local change may unintentionally affect bootstrap, navigation, messages, permissions or asynchronous lifecycle; code review and automated isolation are harder.

**Action:** freeze feature expansion inside the main inline controller; extract only bounded functions behind explicit contracts, one domain per PR, beginning with pure helpers and lower-risk UI utilities. Keep chat/realtime/media last.

### A-02 — Shared global runtime contract is still implicit
**Priority: P1 — boundary hardening**

Reviewed extracted modules such as `profile-status-and-conversation-images.js` and `status-workspace.js` directly use globals including `state`, `supabaseClient`, and `toast`. This preserves compatibility but makes module ownership, initialization order, test doubles and failure behavior implicit.

**Risk:** initialization-order regressions, cross-feature state mutation and difficult unit tests.

**Action:** introduce a compatibility facade in stages (read-only state selectors, scoped services, event/command APIs). Do not mechanically split or rename the shared state object. Require each new extraction to declare its dependencies and avoid adding new globals.

### A-03 — PWA shell and feature-module inventory require a single enforced contract
**Priority: P1 — reliability**

The service worker precaches a growing list of application assets, while HTML and scripts also declare their own asset dependencies. The source currently includes extracted modules and styles as a manually maintained list. A feature's files can be present in HTML but absent from offline precache, or stale files can remain precached after removal.

**Risk:** online works while installed/offline or update-transition behavior breaks; stale assets may persist.

**Action:** create a static asset-contract test that extracts local script/style/manifest/icon dependencies from HTML and verifies expected precache coverage, intentional exceptions and cache-version policy. Avoid caching authenticated/API responses. Test upgrade from the previous cache version.

### A-04 — Removed-feature residue may be retained in the asset pipeline
**Priority: P2 — cleanup after inventory**

The reviewed HTML still links `modules/message-reactions.css`; the service worker also lists reaction JS/CSS assets. The architecture document says the reaction feature was removed from the client runtime. This indicates potential asset residue, but the full caller/asset inventory is required before deletion.

**Risk:** needless cache size, confusing maintenance surface and inaccurate inventory.

**Action:** confirm all references, tests and historical intent; then remove only unused runtime assets in a dedicated PR. Keep historical SQL untouched.

### A-05 — Feature modules are not all isolated contracts yet
**Priority: P2 — staged improvement**

Modules such as backup/restore, status workspace, conversation images, voice recording and message loading have distinct responsibilities, but some directly access application globals and DOM. Their boundaries are partial rather than uniformly service-based.

**Risk:** regressions during future module changes and limited test isolation.

**Action:** establish a module contract template (dependencies, ownership, lifecycle cleanup, asynchronous cancellation/stale-result guard, failure handling, tests, PWA assets). Apply it when touching a module rather than mass-refactoring all modules.

### A-06 — Deployment truth remains an external verification gate
**Priority: P1 — operational**

Repository documentation describes static hosting and cautions that actual Pages/Vercel settings, production branch, build/output configuration, Auth redirect settings and current production domain must be independently confirmed. Source alone does not prove which host/configuration is active.

**Risk:** preview/production configuration drift or deploying the wrong target.

**Action:** no deployment change in this audit. Maintain an externally verified deployment checklist and require approval before changing Pages/Vercel or Supabase Auth settings.

## Strengths confirmed in the reviewed source

- `modules/runtime-config.js` validates HTTPS Supabase origins, an explicit target/host allowlist, and rejects secret/service-role key forms; production targets are pinned to the approved host and preview/test targets reject production.
- `service-worker.js` separates shell/CDN caches and excludes non-GET requests and cross-origin API requests from its cache handler; navigation has a shell fallback.
- Extracted modules include some stale-result/identity checks and signed-URL expiry handling.
- PR #188 was merged after disposable local runtime verification; this audit does not claim that its migration was applied to production.

## Prioritized execution plan

1. **Architecture safety tests:** asset/cache contract, script ordering, global-contract inventory, accidental duplicate listeners/IDs and static secret scan.
2. **Boundary hardening:** introduce a small compatibility facade; no sweeping state rewrite.
3. **Extract pure/shared helpers:** formatting, validation, DOM construction, safe text/URL helpers, tests.
4. **Extract lower-risk domains:** diagnostics/theme/settings and selected bounded UI domains.
5. **Lifecycle-heavy domains last:** messages, realtime, conversations, groups/channels, media.
6. **Per-PR gates:** regression tests, PWA cache contract, preview verification, no production DB/Auth/Storage change without separate approval.

## Explicit non-actions

- No application code changed.
- No Supabase migration, production schema, RLS, Storage, Auth or data changed.
- No deployment or hosting configuration changed.
- No bulk refactor performed.
- This report does not claim a full AST dependency graph, complete test execution, or live production configuration verification.

## Acceptance criteria for the next implementation PR

- Add a repeatable test for the PWA asset/cache contract.
- Add a static check preventing newly introduced unapproved globals in extracted modules (with an explicit allowlist).
- Record the module dependency/lifecycle contract for the first module touched.
- Demonstrate relevant regression and preview checks.
- Keep the PR small, isolated and reviewable.
