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
