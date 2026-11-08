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

This is a logical dependency cycle, not an ES-module import cycle. The current ordered script loading allows the global functions to exist before normal user interaction, but the coupling makes independent testing, replacement, and maintenance difficult.

## Dependency observations

- `core.js` is the cleanest foundational module in this scan; no calls to other feature-module functions were detected.
- `admin.js` depends on `core.js` only.
- `auth.js` is an application-entry orchestrator and calls into most feature modules after authentication.
- `notifications.js` calls into core, conversations, and messages.
- The five-module strongly connected component above is the remaining main decoupling target.
- First safe edge removal: channel navigation now dispatches `bizmind:open-conversation`; `conversations.js` owns the listener.
- Second safe edge removal: conversation-list lifecycle now dispatches `bizmind:render-my-channels`; `channels.js` owns the listener. This removed the direct `conversations.js` → `channels.js` function dependency and moved `channels.js` outside the cyclic component.
- `app.js` still contains global wiring and runtime wrappers that replace functions such as `renderConversations`, `openConversation`, `loadConversations`, and `renderMessage`. These wrappers are an additional coupling surface and should be retired incrementally, not removed in one pass.

## Loading and cache checks

The HTML loads Supabase UMD first, then the ten feature scripts in a fixed order, followed by `app.js`, `workspace.js`, and `membership.js`. The service worker precaches all ten feature files, `app.js`, `workspace.js`, and the application shell assets. These ordering/cache invariants must remain covered during refactoring.

## Safe migration sequence

1. **Establish contracts without changing behavior.** Keep the classic-script runtime and current load order; define explicit feature boundaries and document the callable surface.
2. **Extract shared application contracts.** Move cross-feature coordination behind narrow callbacks/events, beginning with conversation lifecycle and message rendering. Avoid broad rewrites.
3. **Break the remaining five-module cycle incrementally.** Two channel/conversation edges have already been replaced with named window events. Continue with one narrow contract at a time; after each edge is removed, run the architecture check and syntax/build checks. Do not move a provider ahead of its dependencies until calls are routed through a contract.
4. **Retire app.js monkey-patching.** Move each wrapper to the owning feature module or an explicit composition layer, one wrapper at a time.
5. **Add behavioral regression coverage.** Verify startup/Home, authentication, direct/group/channel opening, chronological message rendering, realtime updates, notifications, media, workspace, and owner dashboard.
6. **Only then consider ES modules.** Do not switch module systems until the dependency graph is acyclic and deployment/service-worker behavior is covered.

## Guardrails

- No Supabase schema, RPC, RLS, migration, or data changes are part of this audit.
- No visual or user-facing behavior changes are intended.
- The current swipe/reaction issue remains explicitly deferred; this audit does not claim to fix it.
- The static dependency scan is heuristic. It identifies direct function-name references, not every possible dynamic call or runtime dependency. Browser testing remains mandatory.
- Do not merge PR #72 or deploy to production until the user has manually approved the preview and all required regression checks pass.
