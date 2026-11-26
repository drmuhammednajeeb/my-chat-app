# Engineering Remediation Program — 1000-Point Acceptance

**Baseline:** `main` at `2dad7ef4e61fa1440eed7f123e3596838a1a4e58` (2026-11-26)  
**Visibility:** Repository remains PUBLIC.  
**Execution model:** Isolated branches and reviewed PRs; no direct pushes to `main`.  
**Production safety:** No production database, Auth, Storage, user data, or deployment changes are authorized by this program. Production changes require a separate explicit approval after disposable-environment validation.

## Purpose and scoring rule

The earlier 742/1000 score is a provisional source-review estimate, not a verified certification. The target score is an evidence-based acceptance score. A control earns credit only when its implementation, test, and reproducible evidence are present. An existing control is not reimplemented merely to satisfy this checklist.

## Current repository evidence

- Main baseline: `2dad7ef4e61fa1440eed7f123e3596838a1a4e58`.
- Open security audit PR #187 records live read-only Supabase observations. It explicitly states remediation has not yet been applied.
- Open architecture audit PR #189 records source-level findings and explicitly does not claim a complete AST dependency graph or live deployment verification.
- Existing tests include architecture safety, module dependency contracts, least-privilege SQL assertions, Storage runtime probes, local Supabase replay, message lifecycle, backup/restore and build checks.
- The existing architecture safety test already checks local HTML asset existence, service-worker shell precache coverage, cache version/config network-only behavior, manifest icon coverage and duplicate static IDs.
- Existing least-privilege fixtures are test-only and guarded for disposable local replay. They are not proof that the hosted production database has received those changes.

## Confirmed findings requiring controlled remediation

### Security — P0/P1
1. Live audit PR #187 reports effective `REFERENCES`, `TRIGGER`, and `TRUNCATE` grants to client roles on public tables. Validate compatibility on disposable local Supabase, then prepare a forward migration revoking unnecessary privileges.
2. Live audit PR #187 reports broad default ACLs for the application migration owner. Narrow only application-owned defaults; do not alter Supabase-managed `supabase_admin` defaults.
3. Review `public.delete_message_secure(uuid)` SECURITY DEFINER body, caller authorization, membership checks, search_path and EXECUTE grants before changing its exposure.
4. Review Storage table ACLs and bucket policies together. Test uploader-folder ownership, private/shared read semantics, upsert and delete compatibility locally.
5. Confirm leaked-password protection setting with an authorized configuration read. Any dashboard setting change is a separate approval-gated action.
6. Review every SECURITY DEFINER function and exposed view, not only the finding named above.
7. Complete source scan for DOM injection sinks, unsafe URL assignment, secret leakage, auth/session handling and authorization based on user-editable metadata.

### Architecture — P1
1. Treat the inline controller in `index.html` and implicit globals as the main maintainability risk.
2. Introduce explicit dependency facades incrementally; do not mass-rewrite shared state or lifecycle-heavy messaging.
3. Enforce module contracts: dependencies, state ownership, initialization order, cleanup, cancellation/stale-result guards, failure behavior, tests and PWA assets.
4. Expand static architecture tests for unapproved globals, script ordering, duplicate event wiring and unreferenced assets.
5. Remove unused feature assets only after a full caller, HTML, test and service-worker reference inventory.

### Performance and reliability — P1/P2
1. Establish repeatable browser performance baselines before optimization.
2. Test 100/500/1,000/5,000-message timelines, pagination, rapid conversation switching, offline/online recovery and concurrent Realtime events.
3. Verify one active subscription per intended channel and deterministic cleanup of subscriptions, polling and timers.
4. Measure P50/P95/P99 for boot, conversation open, message send and message receive.
5. Profile DOM reconciliation and query patterns before changing them.

### Integration tests — P1
1. Use disposable Supabase and synthetic accounts only.
2. Exercise registration, verified/active membership, direct chats, groups, channels, message edit/delete, attachments, voice, statuses, backup/restore and cross-user denial.
3. Add browser E2E and concurrency tests where a deterministic test environment exists.
4. Preserve failure cases as regression tests; never weaken or skip tests to obtain a green build.

### Delivery and operations — P1/P2
1. Verify build artifacts for each supported host independently.
2. Test service-worker upgrade and rollback across cache versions.
3. Confirm deployment target, environment isolation and runtime configuration before release.
4. Keep migration source-of-truth and archive/unapplied SQL separation enforced.
5. Verify rollback/recovery procedures and backup restore integrity.

## 55-point implementation register

Status values: `EXISTING—VERIFY`, `OPEN`, `BLOCKED—APPROVAL`, `DONE—EVIDENCE REQUIRED`. No item is marked DONE merely because a similarly named file exists.

| # | Control | Initial status |
|---:|---|---|
| 1 | Inventory all SECURITY DEFINER functions | OPEN |
| 2 | Audit PostgreSQL grants and default ACLs | OPEN — live findings recorded in PR #187 |
| 3 | Verify RLS enabled and policy correctness | EXISTING—VERIFY |
| 4 | Audit Storage ACLs, bucket policies and object ownership | OPEN — runtime probes exist |
| 5 | Verify cross-user data isolation | EXISTING—VERIFY |
| 6 | Audit privileged RPC membership/ownership checks | OPEN |
| 7 | Review DOM injection sinks and unsafe HTML | OPEN |
| 8 | Audit session/token lifecycle | OPEN |
| 9 | Verify Supabase Auth security settings | BLOCKED—APPROVAL for changes |
| 10 | Scan source and build artifacts for secrets | OPEN |
| 11 | Extract inline controller incrementally | OPEN |
| 12 | Define explicit Core Services contracts | OPEN |
| 13 | Define Application State ownership | OPEN |
| 14 | Isolate Navigation | OPEN |
| 15 | Isolate Directory | OPEN |
| 16 | Isolate Conversation List | OPEN |
| 17 | Isolate Notifications | OPEN |
| 18 | Isolate Group Management | OPEN |
| 19 | Isolate Workspace | OPEN |
| 20 | Isolate Chat Composer | OPEN |
| 21 | Isolate Message Renderer | OPEN |
| 22 | Isolate Message Lifecycle | EXISTING—VERIFY |
| 23 | Isolate Realtime lifecycle | OPEN |
| 24 | Isolate Chat Infrastructure | OPEN |
| 25 | Enforce acyclic module dependencies | EXISTING—VERIFY |
| 26 | Verify message pagination and query bounds | EXISTING—VERIFY |
| 27 | Verify message reconciliation under races | EXISTING—VERIFY |
| 28 | Profile and reduce unnecessary DOM work | OPEN |
| 29 | Verify Realtime subscription lifecycle | OPEN |
| 30 | Verify polling de-duplication and cleanup | OPEN |
| 31 | Audit Supabase query patterns | OPEN |
| 32 | Audit database indexes against query workload | OPEN |
| 33 | Optimize attachment loading only after measurement | OPEN |
| 34 | Run 5,000-message performance scenario | OPEN |
| 35 | Run concurrency/load scenarios | OPEN |
| 36 | Build authenticated multi-user E2E suite | OPEN |
| 37 | Test registration and email verification | EXISTING—VERIFY |
| 38 | Test direct conversations end-to-end | EXISTING—VERIFY |
| 39 | Test groups and channels end-to-end | OPEN |
| 40 | Test attachment and voice workflows | EXISTING—VERIFY |
| 41 | Test edit/delete lifecycle | EXISTING—VERIFY |
| 42 | Test offline/online recovery | OPEN |
| 43 | Test concurrent writes and duplicate prevention | OPEN |
| 44 | Test encrypted backup/restore end-to-end | EXISTING—VERIFY |
| 45 | Test non-member denial across API and Storage | EXISTING—VERIFY |
| 46 | Enforce migration source-of-truth | EXISTING—VERIFY |
| 47 | Verify production/preview/test isolation | EXISTING—VERIFY |
| 48 | Verify host-specific build artifacts | EXISTING—VERIFY |
| 49 | Test service-worker cache upgrade/rollback | EXISTING—VERIFY |
| 50 | Verify Pages and Vercel deployment state | OPEN |
| 51 | Test deployment rollback | OPEN |
| 52 | Test recovery after failed deployment | OPEN |
| 53 | Audit accessibility with automated and manual checks | OPEN |
| 54 | Audit CSS duplication and cascade conflicts | OPEN |
| 55 | Enforce required quality gates on every PR | EXISTING—VERIFY |

## Required phase gates

### Gate 1 — Security
- No unresolved critical/high security finding.
- Disposable-local SQL replay passes.
- ACL assertions pass for tables, sequences, functions and defaults.
- RPC and Storage compatibility tests pass.
- No production mutation performed by this PR.

### Gate 2 — Architecture
- Module inventory and dependency contracts are current.
- No new unapproved implicit globals.
- No missing or duplicate shell assets.
- Regression suite passes after each bounded extraction.

### Gate 3 — Performance
- Baselines recorded before changes.
- 5,000-message and concurrency scenarios pass defined thresholds.
- No duplicate Realtime subscriptions or leaked timers.

### Gate 4 — End-to-end quality
- Multi-user E2E flows pass in disposable environment.
- Cross-user denial is proven.
- Backup/restore round-trip passes.

### Gate 5 — Release
- Required CI checks pass on PR head.
- Build artifacts are verified.
- Preview is tested.
- Production release is separately approved.
- Main and deployment are checked after merge.

## Working rules

- One bounded change per PR wherever possible.
- Squash merge only after review and all required checks pass.
- Re-read current `main` before each new branch; never assume an old SHA is current.
- No force-push, no direct main edits, no production SQL, no production Auth/Storage changes, no deploy without approval.
- Update this register with commit, PR, test run and evidence links as work completes.
- Recalculate the score only at phase gates; do not award points for unverified claims.
