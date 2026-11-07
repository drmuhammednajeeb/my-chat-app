# Feature Module Dependency Audit

**Branch:** `refactor/modular-app-entrypoints`  
**Scope:** Static source audit after the 186-function extraction and syntax repairs.  
**Status:** Inventory only; no runtime behavior or database changes.

## 1. Current architecture boundary

The ten feature files are currently classic scripts, not isolated ES modules. They are loaded synchronously before `app.js`, and their function bodies resolve shared top-level lexical bindings when called.

The current shared runtime remains in `app.js`:

- Supabase client and authentication lifecycle
- The central mutable `state` object
- DOM lookup and shared UI helpers
- Browser event wiring and startup sequencing
- Performance storage and diagnostics state

This compatibility boundary is intentional for the extraction stage. It preserves the existing call model, but it also means that moving functions into files has **not** yet produced independent modules or independent state ownership.

## 2. Feature responsibility and coupling

| Module | Primary responsibility | Main shared state areas | Important cross-feature dependencies | Coupling |
|---|---|---|---|---|
| `core.js` | Theme, shared UI skeletons, scroll helpers, performance and diagnostics | theme preference, diagnostics, message-scroll state, performance samples | Auth settings, conversation receipts, message indicators | Medium |
| `auth.js` | Sign-in, sign-up, password reset, profile bootstrap and app entry | auth mode, user, profile, account settings, startup lifecycle | Conversations, notifications, presence, Team Dashboard, settings | Critical |
| `notifications.js` | Notification loading, rendering, read state and navigation | notifications, unread count, notification channel/filter | Conversation navigation, message jump, mute and notification settings | High |
| `conversations.js` | Conversation directory, direct chats, sidebar, preferences and active-chat lifecycle | conversations, active conversation, directory, chat preferences, member state, workspace state | Messages, realtime subscriptions, groups, channels, notifications, workspace | Critical |
| `messages.js` | Message loading, rendering, sending, editing, deletion, reactions, pins and selection | messages, message IDs, replies, edits, reactions, pins, upload state | Conversations, realtime, group permissions, media, receipts | Critical |
| `realtime.js` | Presence, subscriptions, event handlers and polling fallback | realtime channels, presence, polling generation, message state | Conversations, messages, groups, notifications, workspace | Critical |
| `groups.js` | Group creation, membership, roles and settings | active group, group settings, member selection | Conversations, messages, avatars and membership state | High |
| `channels.js` | Channel directory, creation, join and invite flows | conversations, sidebar view, selected group profiles | Groups and conversation navigation | High |
| `admin.js` | Owner-only Team Dashboard and member administration UI | admin flag, team data, group/member filters and loading state | Core loading UI and server-authorized admin RPCs | Critical |
| `media.js` | Avatar upload, attachments, voice capture and recording lifecycle | voice recorder/stream/timers, attachment, upload state, profile | Messages, conversations, realtime typing and profile UI | Critical |

## 3. Shared dependencies observed

A lexical reference scan confirms recurring dependencies on:

- `state`: central mutable application state referenced by every feature module.
- `supabaseClient`: shared Supabase client used by authentication and data/realtime operations.
- `$`: shared DOM lookup helper.
- `toast`: shared user-feedback helper.
- Cross-feature functions such as `loadConversations`, `openConversation`, `loadMessages`, `renderMessage`, `renderConversations`, `resizeComposer`, `diagLog` and `recordPerf`.

The `state` object has broad ownership overlap. Examples include conversation and message modules both changing active-conversation/message lifecycle fields; realtime mutating message and conversation state; media changing composer and upload state; and auth initiating several feature loaders after session validation.

This is why a mechanical move of state fields would be unsafe.

## 4. Recommended decoupling sequence

1. **Define a stable runtime context.** Introduce one explicit context contract for the Supabase client, DOM helpers, shared UI helpers, state access and diagnostics. Do not create a second Supabase client.
2. **Assign state ownership before moving fields.** Document each state field's owner, readers, writers and lifecycle. Start with bounded areas such as theme/preferences and notifications.
3. **Move one bounded service at a time.** Convert direct calls into named service interfaces only where the dependency boundary is clear. Keep a temporary compatibility facade for existing callers.
4. **Separate orchestration from feature logic.** Authentication/startup and active-conversation orchestration should call feature services; feature modules should not initialize themselves during script evaluation.
5. **Only then consider ES modules or bundling.** Preserve the existing script-order and PWA-cache contracts until a deliberate migration replaces them.

## 5. Required gates

- Preserve all 186 extracted function bodies and existing observable behavior.
- No duplicate Supabase clients, implicit initialization side effects or circular startup dependencies.
- Keep server-side authorization and RLS as the security boundary; UI visibility is not authorization.
- Do not modify Supabase schema, policies, RPCs, Storage or production data as part of frontend modularization without separate explicit approval.
- Validate all JavaScript syntax, script order, preloads and service-worker precache on every change.
- Require Preview smoke tests for sign-in, conversation navigation, messages, groups/channels, notifications, media and owner-only Team Dashboard before merge.
- Do not describe parser checks or a successful deployment as authenticated runtime/E2E verification.

## 6. Audit limitations

This is a static lexical dependency inventory, not an AST-derived complete call graph. Dynamic property access, callbacks, event wiring, closures and runtime-generated references can create dependencies that a text scan cannot prove. Before changing a boundary, inspect the full function body, all callers and the relevant startup path.
