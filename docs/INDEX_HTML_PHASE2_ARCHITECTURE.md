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

## Phase 2 score — after Wave 2 (200)
| Dimension | Before | After | Evidence |
|---|---:|---:|---|
| Responsibility/dependency mapping | 15/50 | 40/50 | Observed boundary inventory |
| Module/API boundary design | 15/50 | 40/50 | Narrow pure-utility facades |
| Actual decomposition | 15/50 | 35/50 | Two utilities extracted; core remains large |
| Repeatable guardrails/tests | 15/50 | 45/50 | Audit, focused tests, dependency inventory, precache and CI |
| **Total** | **60/200** | **160/200** | Partial phase; more extraction required |

Score is an evidence-weighted engineering rubric, not a reliability metric. Phase 2 is not closed.
