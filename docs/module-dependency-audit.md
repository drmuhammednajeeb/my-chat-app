# Module Dependency Audit

**Audit date:** 2026-11-08  
**Audited branch:** `refactor/modular-app-entrypoints-mainline`  
**Pull request:** [#72](https://github.com/drmuhammednajeeb/my-chat-app/pull/72)  
**Audited head before this audit commit:** `9e0881f81aac14f5da13803e94a0275214a85527`

## Executive finding

The ten feature files are extracted, but they are **not yet independently isolated modules**. They are classic scripts sharing the browser global scope: they contain no ES module imports/exports and call functions declared by other files directly.

A static function-reference scan initially found a strongly connected dependency component across six modules. The first decoupling pass has now removed `channels.js` from that component. The remaining strongly connected component is:

- `conversations.js`
- `messages.js`
- `realtime.js`
- `groups.js`
- `media.js`

The second decoupling pass also removed several direct edges: `groups.js` requests avatar rendering through `bizmind:render-avatar`; `media.js` sends typing and edited-message notifications through `bizmind:publish-typing` and `bizmind:message-updated`; chat-avatar and conversation-list refresh requests are now owned by `conversations.js` through named events. The function-reference graph now reports 31 cross-module edges (down from 34 after the first pass and 35 at the original baseline) and 187 feature-module function declarations (three helper definitions were relocated/removed from their former owner file). The five-module strongly connected component remains.

This is a logical dependency cycle, not an ES-module import cycle. The current ordered script loading allows the global functions to exist before normal user interaction, but the coupling makes independent testing, replacement, and maintenance difficult.

## Dependency observations

- `core.js` is the cleanest foundational module in this scan; no calls to other feature-module functions were detected.
- `admin.js` depends on `core.js` only.
- `auth.js` is an application-entry orchestrator and calls into most feature modules after authentication.
- `notifications.js` calls into core, conversations, and messages.
- The five-module strongly connected component above is the remaining main decoupling target.
- First safe edge removal: channel navigation now dispatches `bizmind:open-conversation`; `conversations.js` owns the listener.
- Additional contracts: `bizmind:render-avatar`, `bizmind:publish-typing`, `bizmind:message-updated`, `bizmind:render-chat-avatar`, and `bizmind:render-conversations` keep the owning module responsible for rendering or transport behavior while removing direct calls.
- Second safe edge removal: conversation-list lifecycle now dispatches `bizmind:render-my-channels`; `channels.js` owns the listener. This removed the direct `conversations.js` → `channels.js` function dependency and moved `channels.js` outside the cyclic component.
- `app.js` still contains global wiring and runtime wrappers that replace functions such as `renderConversations`, `openConversation`, `loadConversations`, and `renderMessage`. These wrappers are an additional coupling surface and should be retired incrementally, not removed in one pass.

## Loading and cache checks

The HTML loads Supabase UMD first, then the ten feature scripts in a fixed order, followed by `app.js`, `workspace.js`, and `membership.js`. The service worker precaches all ten feature files, `app.js`, `workspace.js`, and the application shell assets. These ordering/cache invariants must remain covered during refactoring.

## Safe migration sequence

1. **Establish contracts without changing behavior.** Keep the classic-script runtime and current load order; define explicit feature boundaries and document the callable surface.
2. **Extract shared application contracts.** Move cross-feature coordination behind narrow callbacks/events, beginning with conversation lifecycle and message rendering. Avoid broad rewrites.
3. **Break the remaining five-module cycle incrementally.** Channel/conversation, group/avatar, media/realtime, and media/conversation call paths have been partly replaced with named window-event contracts. Continue with one narrow contract at a time; after each edge is removed, run the architecture check and syntax/build checks. Do not move a provider ahead of its dependencies until calls are routed through a contract.
4. **Retire app.js monkey-patching.** Move each wrapper to the owning feature module or an explicit composition layer, one wrapper at a time.
5. **Add behavioral regression coverage.** Verify startup/Home, authentication, direct/group/channel opening, chronological message rendering, realtime updates, notifications, media, workspace, and owner dashboard.
6. **Only then consider ES modules.** Do not switch module systems until the dependency graph is acyclic and deployment/service-worker behavior is covered.

## Guardrails

- No Supabase schema, RPC, RLS, migration, or data changes are part of this audit.
- No visual or user-facing behavior changes are intended.
- The current swipe/reaction issue remains explicitly deferred; this audit does not claim to fix it.
- The static dependency scan is heuristic. It identifies direct function-name references, not every possible dynamic call or runtime dependency. Browser testing remains mandatory.
- Do not merge PR #72 or deploy to production until the user has manually approved the preview and all required regression checks pass.


## Regression protection — 2026-11-08

Added `scripts/check-module-regressions.mjs` as a repeatable Node.js regression guard for the event boundaries already established between channels/conversations, groups/media, media/realtime/conversations, and messages/conversations.

Run:

```sh
node scripts/check-module-regressions.mjs
```

The guard verifies that the removed direct calls stay absent and that each event producer and owning listener remains present. It also protects the current rule that `core.js` must not call feature-module functions. This complements (rather than replaces) `scripts/check-module-architecture.mjs`; it does not claim browser-level functional coverage or a compiler-grade dependency graph.


## Additional boundary cleanup — conversation UI events

- `messages.js` now publishes read-receipt list refresh through the existing synchronous `bizmind:render-conversations` event rather than calling `renderConversations()` across the module boundary.
- Message-selection mode now publishes `bizmind:close-chat-header-menu`; `conversations.js` owns the menu-close operation.
- Removed the unused `bizmind:render-chat-avatar` listener after checking every runtime source: there was no producer for this event. The chat-avatar renderer remains owned and called within `conversations.js`; no active media workflow depended on the orphan listener.
- The regression guard now protects both new message/conversation event contracts and prevents the orphan listener from silently returning.


## Composition-root cleanup — `app.js`

Removed the feature-function monkey-patching block from `app.js`. The behavior now resides with its owning modules:

- Sidebar view changes refresh custom-list UI in `conversations.js`.
- Conversation-list heading synchronization is owned by the conversation-list renderer.
- Opening a conversation applies group composer permissions and refreshes its menu within the conversation lifecycle.
- Conversation loading refreshes custom lists and per-user conversation settings within `loadConversations()`, including its existing failure/empty paths.
- Saving direct-chat preferences updates the owning state and menu in `saveDirectChatPreference()`.
- The duplicate no-op notification wrapper and redundant mute-menu wrapper were removed.
- Message selection decoration now runs inside `renderMessage()`; the app-level MutationObserver and render wrapper were removed.

The regression guard now rejects feature-function reassignment wrappers and app-level message DOM observers. `app.js` remains the composition/startup and DOM event-wiring layer; this pass does not yet convert the classic-script runtime to native ES modules.


## Group/message boundary pass

- Replaced the direct `groups.js` → `messages.js` calls to `setMessageSelectionMode()` with the synchronous `bizmind:set-message-selection-mode` command event; `messages.js` remains the owner of selection state and rendering.
- Replaced `messages.js` and `conversations.js` direct calls to `ensureGroupModal()` with `bizmind:ensure-group-modal`; `groups.js` owns modal construction.
- The calls were confirmed to be command-style operations with no consumed return value, so synchronous DOM events preserve their ordering without introducing fire-and-forget async behavior.
- Added regression assertions for both event producers and their owning listeners.


## Media ownership pass — avatars and voice cancellation

- `conversations.js` and `realtime.js` no longer call `renderAvatar()` directly. Both publish `bizmind:render-avatar`; `media.js` owns avatar DOM rendering through its existing listener.
- `conversations.js` no longer calls `cancelVoiceRecording()` directly when switching conversations. It publishes `bizmind:cancel-voice-recording`, handled synchronously by `media.js`.
- These are synchronous presentation/lifecycle commands with no consumed return values. The voice cancellation listener immediately invokes the existing cancellation routine, preserving ordering before the new conversation loads.
- Regression tests now protect the producer/listener pairs and forbid direct calls from the requesting modules.


## Shared conversation-model primitives

Moved `SELF_CHAT_MARKER`, `isSelfConversation()`, `otherMember()`, and `convName()` into `core.js`. These are pure/shared model helpers over the established global state and are consumed by several feature modules; keeping them in the foundational layer removes the `messages.js` → `conversations.js` dependency without duplicating conversation-name semantics (including the self-chat label).

## Revalidation after shared group-helper ownership correction

At commit `84b436d039a45b1970daaeb64f8802e097c7408a`, the duplicate definitions of `groupRole()` and `isGroupAdmin()` were removed from `groups.js`. Both helpers are now defined once in `core.js`, which is their shared owner.

Revalidation results:

- All ten feature-module sources pass JavaScript syntax parsing.
- No duplicate top-level function declarations remain across the ten feature modules.
- The static dependency scan reports 27 cross-module edges.
- `core.js` has no outgoing feature-module dependencies in the scan.
- The remaining strongly connected component is `conversations.js`, `realtime.js`, and `groups.js`.
- The three-way cycle is backed by direct call sites: conversations invokes realtime lifecycle functions and group starred-message loading; realtime invokes conversation rendering/loading functions and group state/presentation functions; groups invokes conversation rendering/loading functions.
- Script inclusion order in `index.html` remains correct, and all ten modules remain in the service-worker precache.
- The regression assertions for the existing event boundaries and composition-root constraints pass in the source-level recheck.

The dependency scan is a name-based static heuristic rather than an AST/type-aware analyzer. Its edge list is therefore used to locate candidate dependencies; the cycle above was separately checked against the direct call sites listed above. Browser-level functional testing has not been performed. CI status at this revision must be read independently of source validation; a Vercel build-rate-limit response is not evidence of a source compilation failure.


## Conversation lifecycle boundary pass — 2026-11-08

- Removed direct `conversations.js` calls into realtime-owned `stopMessagePolling()`, `subscribeConversation()`, `subscribeProfileUpdates()`, and `startMessagePolling()`.
- Added named lifecycle command events (`bizmind:stop-message-polling`, `bizmind:subscribe-conversation`, `bizmind:subscribe-profile-updates`, `bizmind:start-message-polling`) handled by `realtime.js`.
- Replaced the awaited `loadStarredMessageIds()` direct call with `bizmind:load-starred-message-ids`, using an explicit resolver in event detail. The conversation-opening sequence still awaits completion before `loadMessages()`, preserving the original ordering.
- Added regression assertions for the producers, owning listeners, and absence of the old direct calls.
- This pass targets the `conversations.js` → `realtime.js` edge only; it does not claim the complete graph is acyclic. Static and syntax checks must be repeated, and authenticated browser testing remains required.

## Independent backup and restore module — feature branch

The isolated `modules/backup.js` feature is introduced on `feature/backup-restore-module`, based on the latest PR #72 head. It is intentionally not committed to PR #72.

- The module owns its UI, JSON format validation, SHA-256 integrity verification, export, and restore orchestration inside a private IIFE.
- The archive is account-bound (`userId`) and versioned (`schemaVersion`). Import rejects another account, unsupported schema versions, malformed sections, rows owned by another account, and checksum mismatches.
- Export is user-scoped under the existing Supabase RLS policies. It includes the signed-in user's settings, conversation preferences, classifications, labels, notes, stars, and notifications, plus a read-only archive of conversations, accessible messages, reactions, and pins.
- Restore is merge-only and limited to the current user's personal settings and metadata. It never deletes rows. Shared conversations/messages/reactions/pins are never written back. Records tied to conversations the user can no longer access are skipped.
- Authentication secrets, access/refresh tokens, and binary attachment files are excluded. The archive currently contains attachment-independent conversation data only; file binaries require a separate encrypted storage-export design.
- The module is loaded after app state, workspace, and membership initialization, and is included in the service-worker shell precache. The service worker continues to avoid caching Supabase/API responses or authenticated user data.
- No SQL, migrations, schema, RLS, RPC definitions, Storage objects, or live data were modified by this feature branch. The existing `patch_my_user_settings` RPC is called only if the user explicitly confirms restore inside the application.
- Restore spans multiple existing tables and is not a database transaction. If an individual write fails, earlier successful sections remain; the operation reports the failure and is safe to retry because it uses upserts and performs no deletes. A future server-side transactional restore would be required for all-or-nothing semantics.

Validation required before merge: run the architecture and backup regression scripts, syntax checks, then authenticated Preview tests for export, tampered-file rejection, cross-account rejection, merge-only restore, missing conversation references, and offline/service-worker behavior. No browser functional test is claimed by this source change.
