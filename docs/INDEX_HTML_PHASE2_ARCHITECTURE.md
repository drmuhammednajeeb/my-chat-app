# Phase 2 — index.html architecture boundary review

## Scope and safety
- Base: `main`, source snapshot `a9c97439b36c450da1fd042f88fd66bccf825e12`.
- Isolated branch and PR; no merge, production deployment, or production database changes.
- Incremental mapping, a low-risk pure utility extraction, and repeatable guardrails precede larger feature extraction.

## Before
- Entry file: 2,981 lines, 310,090 characters.
- Main inline application script: 256,352 characters / 2,672 lines.
- 233 function declarations/function-like definitions detected by text scan (not AST).
- 11 existing JS feature modules.
- Implicit shared dependencies: `state`, `supabaseClient`, DOM lookup, and direct global calls.
- Classic scripts share global scope; no ES-module import graph in this entry path, so global coupling is the primary boundary risk.

## Responsibility/dependency map
| Boundary | Existing owner | Coupling / notes |
|---|---|---|
| Runtime/deployment | `deployment-config.js`, `modules/runtime-config.js` | Must remain ahead of client/bootstrap |
| Shell/auth/session | Core inline script; `auth-light.js`, `auth-error-messages.js` | Shared state, membership, startup orchestration |
| Messages lifecycle | `message-loader.js`, core rendering/send/edit/realtime | Active-conversation lifecycle and shared state; high risk |
| Reactions | `message-reactions.js` | Existing module boundary |
| Voice/audio | `voice-recorder.js`, `audio-player.js` | DOM/media lifecycle |
| Profile/status/images | `profile-status-and-conversation-images.js`, `status-workspace.js` | Shared state/service coupling |
| Backup/restore | `backup-restore.js` | Large, sensitive module with state/client/toast globals |
| Updater | `app-updater.js` | Existing updater boundary |
| Membership | `membership.js` | External script; further boundary analysis needed |
| Conversation workspace | Core inline script | Notes, documents, labels, classification rules |
| Admin/team/group | Core inline script | Global state/client and DOM event wiring |

## Extraction executed
- Moved the pure password-strength calculation into `modules/password-strength.js`.
- Extracted signup display-name normalization and validation into `modules/signup-name-validation.js`, preserving the two-to-three-part Arabic/Latin validation contract and Unicode NFC/whitespace normalization.
- UI wrapper delegates through `window.BizmindPasswordStrength.calculate()`.
- Module exposes a frozen facade, with no imports/exports and classic-script compatibility.
- Loaded before the inline core script; focused tests cover empty, short, medium, strong and very-strong cases.
- This is an incremental proof, not a claim that the core script has been modularized.

## Guardrails
- `scripts/audit-index-architecture.mjs`: repeatable source contract audit.
- `tests/index-architecture.test.mjs`: extraction and ordering tests.
- Dedicated CI workflow.
- Main inline-script ceiling 260,000 characters is temporary and should be reduced as later extractions proceed.

## Rules for future extraction
1. Runtime config must precede client initialization.
2. Modules expose narrow facades; avoid adding undocumented globals.
3. Shared mutable state stays core-owned until a deliberate facade is designed.
4. Feature modules should not bind against partially constructed DOM.
5. Async callbacks must fence session/conversation changes.
6. Extract one responsibility at a time with behavior contracts.
7. No wholesale rewrite or backend/schema changes in this phase.

## Phase 2 score — after Wave 3 (200)
| Dimension | Before | After | Evidence |
|---|---:|---:|---|
| Responsibility/dependency mapping | 15/50 | 40/50 | Observed boundary inventory |
| Module/API boundary design | 15/50 | 45/50 | Narrow pure-utility facades |
| Actual decomposition | 15/50 | 40/50 | Three responsibilities incrementally extracted; inline core remains large |
| Repeatable guardrails/tests | 15/50 | 45/50 | Audit, focused tests, dependency inventory, precache and CI |
| **Total** | **60/200** | **170/200** | Partial phase; more extraction required |

Score is an evidence-weighted engineering rubric, not a reliability metric. Phase 2 is not closed.


## Wave 3 extraction
- Extracted the database query/filtering portion of active-conversation search into `modules/conversation-search.js`; UI rendering and message-jump behavior remain core-owned.
- Narrow API: `searchConversationMessages({client, conversationId, query, clearedBefore, hiddenIds, isCurrent})`; preserves the conversation scope, substring match, cleared-history boundary, chronological ordering, 30-result limit, hidden-message filtering and stale-request fence.
- Loaded before the inline core and precached in service-worker cache v52.
- Added isolated tests for API shape, invalid input, query contract, hidden-message filtering, stale fencing, errors and script load ordering.
- Wave 3 score: 170/200 (rubric assessment, not reliability measurement). Before Phase 2 60/200; Wave 2 160/200.


## Wave 4 — Performance analytics extraction
- Extracted local privacy-safe telemetry storage, sample recording and persistence, percentile calculation, summary aggregation (resource/network data), and long-task observer setup into `modules/performance-analytics.js`.
- `index.html` retains a compatibility facade (`recordPerf`, `persistPerfSamples`, `performancePercentile`, `performanceSummary`) so existing call sites remain unchanged.
- Module receives a diagnostics callback rather than owning the diagnostics UI.
- Added standalone tests for API/load ordering, percentile edge cases, bounded samples, persistence, summary, pagehide and precache contract.
- Registered module dependency/inventory; service-worker shell cache bumped to v53.
- Wave 4 completion is pending CI execution and code review. Preliminary score: 180/200 rubric estimate, contingent on tests passing; no merge or production deployment.


## Wave 5 — message timeline boundary extraction
- Extracted the narrowly scoped timeline reconciliation and cancelled-history rollback helpers into `modules/message-timeline.js`; existing inline call sites delegate through compatibility functions.
- The module remains classic-script compatible and takes the existing state/DOM references as explicit arguments; it does not add backend or database changes.
- Added focused tests for stale timeline ownership, rollback of request-owned rows, preservation of replacement rows, chronological ordering and day-divider reconciliation.
- Registered the module in the dependency contract and safety inventory, loaded it before the core, and precached it in service-worker cache v54.
- Wave 5 verification is pending automated checks; no merge, deployment or production database changes.


## Wave 6 — Deep Core Responsibility Extraction: older-history pagination
- Extracted the asynchronous older-history pagination lifecycle from the inline core into `modules/older-message-loader.js`.
- Kept the inline `loadOlderMessages()` call surface as a compatibility facade, injecting state, backend client, renderer, metadata enrichers, timeline rollback/reconciliation helpers, and toast callback.
- Preserved cursor pagination, cleared-history boundary, reply-context enrichment, stale-conversation/request fences, request-owned rollback, chronological reconciliation, DOM anchoring, and bounded batch size.
- Registered the module in dependency and safety inventories; precached it in the shell and bumped service-worker cache to v55.
- Added focused boundary tests for API shape, safe no-op preconditions, cursor and chronological commit behavior.
- Wave 6 is awaiting CI validation; this extraction does not modify schema, production data, or deployment.


## Wave 7 — Message attachment rendering boundary
- Extracted signed attachment URL resolution and DOM construction for image, video, audio-player, and generic file attachments into `modules/message-attachment-renderer.js`.
- The module receives the message, bubble, client, audio-player factory, document, lightbox lookup, conversation/request fence, toast, and console dependencies explicitly. The inline message renderer retains content/sticker rendering, metadata, menu, reactions, row commit and timeline ownership.
- Preserves one-hour signed URLs, refreshable audio URLs, stale-request fencing, lazy image loading, video controls, safe external link attributes and existing error text.
- Registered the module and focused tests; precached the new script and bumped the shell cache to v56.
- Wave 7 remains isolated and stacked on Wave 6; no production DB changes, deployment, or merge.
