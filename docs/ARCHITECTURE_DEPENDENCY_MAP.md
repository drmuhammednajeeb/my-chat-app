# Architecture & Dependency Map

> Status: discovery baseline for the gradual modularization plan  
> Reviewed branch: `main`  
> Source snapshot: commit `7b417f81800c388dbb209086c5df895fc53abee5`  
> `index.html` blob reviewed: `0eeadc10a8ce6c93ab4dff3434ab7a965d17c33d`  
> Scope: documentation only. No runtime code, database schema, RLS policy, or deployment configuration is changed by this document.

## 1. Executive assessment

The frontend is a static, Arabic-first single-page application. Its current runtime is concentrated in `index.html`, with a separate membership controller and stylesheet, plus a service worker. The main architectural risk is not file size by itself; it is shared mutable state and cross-module calls through browser globals.

The safest migration is incremental and behavior-preserving:
1. establish repeatable checks and a dependency inventory;
2. extract styles without changing selectors or values;
3. isolate infrastructure and shared state behind stable interfaces;
4. extract low-coupling features;
5. extract chat, messages, realtime, and media last.

Do not combine extraction with feature changes, database changes, permission changes, or UI redesign.

## 2. Verified repository baseline

| Area | Observed state |
|---|---|
| Main frontend | `index.html`, approximately 3,049 lines / 369 KB in the reviewed snapshot |
| Script loading | Supabase JS UMD CDN, inline scripts, then `membership.js` |
| Styling | Seven inline `<style>` blocks plus `membership.css` |
| Membership | `membership.js`, approximately 301 lines; `membership.css`, approximately 40 lines |
| PWA | `service-worker.js`, cache version `v14`; `manifest.json` and root icon assets |
| Backend | Supabase Auth, Postgres, RLS, Realtime and Storage; SQL changes tracked under `supabase/` and legacy/change material under `database/` |
| Build tooling | No root `package.json`, Vite config, or `vercel.json` was found in the reviewed root |
| DOM/event wiring | The reviewed `index.html` has many direct DOM lookups and event bindings; an initial scan counted 213 IDs and no duplicate ID values, and no inline HTML event attributes in that snapshot |
| Runtime state | One broad `state` object is declared in the main inline script and consumed by multiple feature areas |

Counts are snapshot-specific and should be regenerated after changes. Regex-based function inventories are useful for orientation but are not a complete AST or call-graph analysis.

## 3. Current runtime and global contracts

### 3.1 Core globals

| Global | Role | Consumers / risk |
|---|---|---|
| `supabaseClient` | Single Supabase JS client configured with the project URL and publishable browser key | Auth, profiles, conversations, messages, reactions, groups, channels, storage, notifications, workspace, membership. Critical shared dependency |
| `state` | Shared mutable application state: user/profile, conversations, active conversation, messages, reactions, presence, notifications, team and workspace data, media/recording state, request versions | Nearly every feature. Critical shared dependency |
| `$` | `getElementById` shorthand | Nearly all UI code; depends on stable DOM IDs |
| `toast` | Shared transient feedback UI | Membership and feature modules |
| `esc`, `initials`, `time` | Formatting / escaping helpers | Rendering and UI modules |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Browser connection configuration | Client initialization; publishable key only, never service-role credentials |
| Theme / performance globals | Theme preference, media query, performance sample buffer and persistence timer | Theme and diagnostics; currently browser-local |

### 3.2 State domains that should become explicit interfaces

- Identity: `user`, `profile`, `userSettings`, membership state and admin flag.
- Navigation: `sidebarView`, `conversationFilter`, `active`.
- Conversations: `conversations`, `conversationsLoading`, direct-conversation promises and per-conversation preferences.
- Messages: `messages`, `messageIds`, `messageLoadVersion`, reply/edit targets, pins, stars, selections and reactions.
- Realtime/presence: channel subscriptions, online users, typing, realtime status and polling lifecycle.
- Media: attachment/upload state and voice recorder/stream/timers/chunks.
- Notifications: list, unread count, filter and subscription.
- Team/admin: team dashboard data, member lists, selection and loading flags.
- Workspace: classifications, labels, rules, private notes, documents and private-reply context.

Do not split the state object mechanically at first. Define ownership and permitted mutations before changing its shape.

## 4. Feature dependency map

Risk scale: **Critical** = shared lifecycle, auth, security-sensitive or realtime; **High** = cross-feature state or complex persistence; **Medium** = mostly bounded UI/data flow; **Low** = isolated presentation/helper code. Risk describes extraction risk, not feature importance.

| Target unit | Current functions / entry points observed | Shared globals / dependencies | Related files / backend | Risk |
|---|---|---|---|---|
| App bootstrap, theme and PWA | `applyAppTheme`, `loadUserSettings`, `saveUserSetting`, `toggleAppTheme`; install prompt and service-worker registration | `state`, `supabaseClient`, `$`, theme globals, browser storage and media-query APIs | `index.html`, `service-worker.js`, `manifest.json`, icons | High |
| Authentication and profile | `setAuthMode`, `authError`, `authProgress`, password-reset helpers, `withAuthTimeout`, `ensureProfile`, `enterApp`, `enterAppInternal`, avatar/profile helpers, `uploadProfileAvatar`, profile modal open/close | `state.user`, `state.profile`, `supabaseClient.auth`, `$`, `toast`, profile lifecycle and membership validation | `index.html`; Supabase Auth, `profiles`, Storage and membership RPCs | Critical |
| Shared UI and formatting | `$`, `esc`, `initials`, `time`, `toast`, avatar rendering, skeleton helpers, modal helpers | DOM IDs, theme tokens, shared state, browser DOM | `index.html`, `membership.css` | Medium |
| Directory and presence | `setSidebarView`, `loadDirectory`, `renderDirectory`, `startPresence` | `state.user`, `state.directory*`, `state.onlineUsers`, `supabaseClient`, `toast` | `index.html`; `profiles`, Supabase Realtime presence | High |
| Conversation list and direct chats | `isSelfConversation`, `ensureSelfConversation`, `otherMember`, `convName`, `convPreview`, `renderConversations`, `bindConversationSwipe`, `loadConversations`, `findDirectConversation`, `openDirectConversation`, direct-chat preference and archive/clear helpers, `openConversation` | `state.conversations`, `state.active`, `state.user`, `state.chatPrefs`, `supabaseClient`, DOM IDs, message lifecycle | `index.html`; `conversations`, `conversation_members`, `user_settings` / preference data | Critical |
| Message lifecycle and rendering | `renderMessage`, `loadMessages`, `loadOlderMessages`, `sendMessage`, `editMessage`, `deleteMessage`, `messagePreview`, composer reply/edit helpers, read receipts, typing | `state.active`, `state.messages`, `state.messageIds`, `state.replyTarget`, `state.editTarget`, `state.messageLoadVersion`, `supabaseClient`, `toast`, DOM | `index.html`; `chat_messages`, receipts, typing and related RPC/RLS | Critical |
| Realtime and polling | `subscribeConversation`, `subscribeProfileUpdates`, `subscribeNotifications`, `subscribePersonalChatData`, `handleMessageUpdateRealtime`, `handleReactionRealtime`, `handlePinRealtime`, `handleMembershipRealtime`, `startMessagePolling`, `stopMessagePolling`, `pollMessagesFallback` | `state.channel`, `state.profileChannel`, `state.notificationChannel`, `state.typingChannel`, request/version flags, `supabaseClient` | `index.html`; Supabase Realtime channels and Postgres changes | Critical |
| Reactions, pins and message actions | `loadMessageReactions`, `renderReactionBar`, `openMessageReactions`, `bindMessageGestures`, `toggleMessageReaction`, reaction modal/member helpers, pin load/toggle/render helpers | Active conversation/message identity, `state.reactions`, `state.pinnedMessages`, message rendering and realtime handlers | `index.html`; `message_reactions`, pin tables/RPCs and RLS | High |
| Voice, attachments and media | `formatVoiceDuration`, voice elapsed/timer/UI helpers, cleanup/pause/resume, `sendVoiceRecording`, `encodeVoiceWav`, fallback recorder, `startVoiceRecording`, `stopVoiceRecording`, `cancelVoiceRecording`, `showAttachmentPreview`, `uploadAttachment` | `state.voice*`, `state.attachment`, `state.uploading`, `state.active`, browser MediaRecorder/stream APIs, `supabaseClient.storage` | `index.html`; private Storage buckets and message attachment metadata | Critical |
| Groups and group administration | `loadGroupCandidates`, `renderGroupCandidates`, `renderGroupSelection`, group modal helpers, `groupRole`, `isGroupAdmin`, `ensureGroupModal`, `openGroupManagement`, `closeGroupManagement`, member/role/settings and composer-permission helpers, group menu actions | `state.active`, group members/roles, `state.groupSettings`, `supabaseClient`, message composer and modal DOM | `index.html`; `conversations`, `conversation_members`, group settings and storage | Critical |
| Channels | `renderMyChannels`, `openChannelModal`, `closeChannelModal`, `shareChannelInvite` and channel directory/create/join event handlers | `state.conversations`, `state.sidebarView`, active conversation, `supabaseClient`, group-role and conversation helpers | `index.html`; channel fields, public/private channel RPCs, avatar Storage and RLS | High |
| Notifications | `notificationIcon`, `renderNotificationBadge`, `renderNotifications`, `loadNotifications`, `subscribeNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `openNotification` | `state.notifications`, unread count/filter/channel, `state.active`, `supabaseClient`, `toast` | `index.html`; notifications table, Realtime and RLS | High |
| Team dashboard and admin | `loadTeamDashboard`, `teamDate`, `teamIsActive`, `renderTeamDashboard`, `renderTeamGroups`, `renderTeamGroupOptions`, `loadTeamMembers`, `renderTeamMembers`, `refreshTeamDashboard`, `changeTeamMemberRole`, `removeTeamMember`, `addTeamMember` | `state.isTeamAdmin`, team data/member state, `supabaseClient`, admin RPCs | `index.html`; private admin RPCs and `app_private.team_admins` | Critical |
| Membership administration | IIFE-private `loadMembershipAdmin`, `createInvites`, `downloadInvites`, `renderMembers`, `renderPendingInvites`, `renderGeneratedInvites` | Reads global `state.isTeamAdmin`, `supabaseClient`, `toast`, fixed DOM IDs; internal loading/invite state | `membership.js`, `membership.css`; membership invitation tables and admin RPCs | High |
| Personal settings, custom lists and saved messages | `loadCustomLists`, `renderCustomLists`, `createCustomList`, `manageCustomList`, picker/toggle helpers, `loadStarredMessageIds`, `openStarredMessages`, `toggleMessageStar`, selection/export helpers, conversation preference and mute/tone/favorite helpers | `state.user`, active conversation, custom-list/star/selection/settings maps and sets, `supabaseClient`, DOM | `index.html`; user-scoped lists, stars, conversation settings and related RLS | High |
| Workspace and private reply context | `loadWorkspaceData`, `runWorkspaceClassificationRules`, `renderWorkspaceInboxTabs`, `setConversationCategory`, workspace modal/labels/rules/notes/documents helpers, `replyPrivatelyToGroupMessage`, `loadPrivateReplyContexts`, `renderPrivateReplyQuote` | `state.user`, conversations, workspace maps/arrays, `state.active`, `supabaseClient`, `toast`, DOM and Storage | `index.html`; classifications, labels, rules, private notes, documents, private reply contexts and Storage | High |
| Diagnostics and performance | `diagLog`, `updateDiagnostics`, `recordComposerInteraction`, `persistPerfSamples`, `recordPerf`, `performanceSummary` | Performance APIs, `localStorage`, diagnostics state and DOM | `index.html`; browser-local performance samples | Medium |
| Service worker / offline shell | install, activate, fetch handlers | Cache names/version, registration scope, asset paths | `service-worker.js`, `manifest.json`, icons, `index.html`, `membership.js`, `membership.css` | High |

**Important:** this is a responsibility map, not a claim that every function has been exhaustively assigned or that the call graph is complete. The code still contains shared closures, callbacks and event-driven entry points. Before moving a function, inspect its full body and all direct/indirect callers.

## 5. File-to-file and deployment dependencies

| File / location | Responsibility | Change implications |
|---|---|---|
| `index.html` | App shell, markup, styles, main controller and event binding | Highest blast radius; avoid bulk extraction |
| `membership.js` | Admin membership UI in an IIFE | Currently relies on globals from the main controller; make dependencies explicit before moving |
| `membership.css` | Membership-specific presentation | Can remain separate; preserve load order |
| `service-worker.js` | Offline shell and static asset cache | Every new extracted CSS/JS asset must be added to install precache if offline support requires it; increment cache version when shell assets change |
| `manifest.json`, icon assets | PWA metadata and install icons | Keep URLs and scope valid |
| `supabase/migrations/` | Ordered database change history | Never reorder or replay blindly; reconcile against the live database before any schema work |
| `database/` | Historical/change SQL material | Determine canonical status before treating as executable migrations |
| `README.md` | Setup, Supabase and deployment instructions | Must match the actual hosting configuration |

### Script order contract

The current page loads the Supabase UMD client before the main inline controller and loads `membership.js` after the main controller. That ordering is a functional dependency. If introducing ES modules or a bundler, replace it deliberately and test the complete startup/auth lifecycle; do not simply add `type="module"` to the existing script tags.

### PWA cache contract

The current service worker precaches the app root, manifest, icons, `membership.js` and `membership.css`; navigation fallback uses cached `index.html`. New static files need an explicit cache policy. Do not cache authenticated API, Realtime, private documents, or message data.

## 6. Recommended extraction order

| Phase | Scope | Why this order | Gate before proceeding |
|---|---|---|---|
| 0 | Baseline inventory, test checklist, deployment confirmation | Establish a known-good reference | Record current commit, deployed URL/build and smoke-test results |
| 1 | CSS only: move the seven inline style blocks into ordered files | Lowest logic coupling; still affects every screen visually | Compare desktop/mobile, RTL, dark/light, dialogs, channel/group layouts; check offline cache |
| 2 | Small pure utilities and UI primitives | Reduces duplication without changing data flow | Unit/snapshot checks for escaping, formatting and DOM helpers |
| 3 | Supabase client/config and explicit service adapters | Centralizes infrastructure before feature movement | Auth, RPC, Storage, RLS and Realtime smoke tests |
| 4 | Diagnostics, theme/settings and notifications | More bounded than chat lifecycle | Persistence, multi-tab theme sync and notification receipt tests |
| 5 | Membership and workspace | Clear feature domains but sensitive data/admin paths | Owner-only access, invitation lifecycle, private notes/docs and Storage policy tests |
| 6 | Directory, presence, groups and channels | Crosses conversation membership and realtime permissions | Two-account membership, discover/join, private/public visibility and admin-role tests |
| 7 | Messages, reactions, pins and media | Highest coupling and lifecycle sensitivity | Full two-account realtime, edit/delete, reply, reactions, voice and attachment tests |

Each phase must be a separate reviewable commit or pull request. A phase must preserve observable behavior. No phase may weaken RLS or replace server-side authorization with client checks.

## 7. Required regression and acceptance tests

### 7.1 Authentication and session
- Sign in, sign out, reload with a valid session, expired session and recovery flow.
- Verify unverified/inactive membership cannot enter the app.
- Verify owner/admin-only surfaces remain hidden and server-protected for ordinary members.
- Verify profile edit and avatar selection/save/cancel on desktop and mobile.

### 7.2 Direct chat and two-account Realtime
Use two separately authenticated test accounts, Account A and Account B, in separate browser profiles or devices:
1. A opens or creates a direct conversation with B.
2. A sends a text message; B receives it without manual refresh.
3. B replies; A receives it.
4. Verify sender, timestamps, unread/read receipts and ordering.
5. Test edit, delete/soft-delete, reply, typing and reconnect after network interruption.
6. Confirm users outside the conversation cannot read the messages.

### 7.3 Groups
- Create a group with A and B; verify both see it and receive messages in realtime.
- Verify admin-only send permissions, member role changes, removal, leaving and owner transfer.
- Verify custom group settings, disappearing-message settings, wallpaper/theme and notifications persist after reload.
- Verify non-members cannot read group messages or files.

### 7.4 Channels
- Create a private channel and invite/join B; verify an unrelated account C cannot discover or join it.
- Create a public channel; verify it appears in discovery and B can join through the supported flow.
- Verify public/private state survives reload and unauthorized users cannot read private channel content.
- Upload, display and refresh channel avatar; verify private Storage access and signed URL expiry/refresh.
- Send messages in a channel and test realtime delivery between A and B.
- Test channel visibility changes, membership changes, invite links and leave/rejoin behavior.

### 7.5 Reactions and message actions
- Add each supported reaction from both accounts.
- Verify reaction counts and member lists update on both clients without refresh.
- Remove/change a reaction; verify one reaction per user/message constraint and correct UI after rerender.
- Verify tray positioning after scrolling, switching conversations, resizing and opening/closing menus.
- Test reactions in direct chats, groups and channels separately.

### 7.6 Media and voice
- Upload and open supported image/document attachments; verify signed URL behavior and membership restrictions.
- Record, pause, resume, cancel and send a voice note; test microphone denial and unsupported browser fallback.
- Verify no duplicate upload/message after retry or interrupted network.

### 7.7 PWA, responsive UI and cache
- Install/open the PWA; verify app shell loads online and offline.
- Confirm the service worker does not cache authenticated/private API responses.
- Test current Chrome desktop and mobile viewport, RTL, light/dark themes, dialogs and long conversations.
- After each asset extraction, verify cache versioning and that stale CSS/JS is not served.

### 7.8 Automated checks
- Add a repeatable static/build check appropriate to the chosen toolchain before introducing one.
- Add unit tests for pure helpers and service contract tests.
- Add browser E2E tests with two independent authenticated contexts for the scenarios above.
- Record which checks are automated and which remain manual. A successful static scan is not proof of authenticated Realtime behavior.

## 8. Security and data-integrity constraints

- Keep the browser key publishable/anon only. Never commit service-role keys, access tokens, invite codes, or secrets.
- RLS and server-side RPC authorization remain the security boundary.
- Do not change Supabase schema, policies, buckets, functions or production data as part of frontend extraction without a separate explicit approval.
- Treat membership numbers and invitation flows as privileged data.
- Preserve private notes/documents and conversation membership boundaries.
- Do not include message contents, personal identifiers or secrets in diagnostics.
- Review SQL in `supabase/migrations/` and `database/` before any database deployment; establish one canonical migration source.

## 9. Known uncertainties / work required before code extraction

1. The repository snapshot contains no root `package.json`, Vite config or `vercel.json`; current deployment behavior is therefore controlled by external Vercel project settings unless configured elsewhere.
2. Confirm Vercel Production Branch, Root Directory, Framework Preset, Build Command, Output Directory and Install Command in the Vercel project dashboard. The production URL documented in the README should be checked against the active project domain.
3. Confirm Supabase Auth Site URL and Redirect URLs use the production Vercel domain; preview URLs should be added deliberately, not with an unnecessarily broad wildcard.
4. Reconcile `supabase/migrations/` with `database/` and the live schema before database-related work.
5. Produce an AST-backed import/call graph once a test/tooling environment is selected. The current function list is a manual/regex inventory, not a complete dependency graph.
6. Establish baseline authenticated E2E tests; none are asserted as already passing by this document.

## 10. Definition of done for each extraction phase

A phase is complete only when:
- the extracted module has a single documented responsibility and explicit dependencies;
- no accidental globals or duplicate Supabase clients are introduced;
- existing behavior and security boundaries are preserved;
- relevant tests pass, including two-account Realtime where applicable;
- PWA asset caching is updated when needed;
- preview deployment is checked;
- the diff is reviewed and approved before merge.

---
This document is an engineering plan and inventory. It does not itself authorize database changes, production deployment, merging, or broad refactoring.


## 11. Modularization implementation — phase 1

**Branch:** `refactor/modular-app-entrypoints`  
**Base:** `2cbe07dcb78e4d7c6780a5a40692c37ea929be1f`

This phase moves the two large inline application scripts into same-origin classic JavaScript assets without changing their source bodies or execution order:

- `app.js`: the main application runtime (Supabase client, shared state, authentication, conversations, messages, groups, channels, realtime and UI handlers).
- `workspace.js`: conversation workspace, labels/classification, private notes/documents and private-reply context.

The HTML keeps both scripts at their original parser positions as blocking classic scripts. Preload hints start their downloads from the document head; they are deliberately **not** marked `async` or `defer`, so existing initialization order and global bindings remain intact. The Supabase UMD script remains before `app.js`, and `membership.js` remains after `workspace.js`.

The service worker precaches both new same-origin assets and advances its shell cache to `v18`. It continues to exclude authenticated API responses and user content.

**Scope boundary:** this is an entry-point extraction, not yet a complete feature-module split. The next phases should extract low-coupling services (diagnostics/notifications/settings) and then progressively isolate conversations, message lifecycle, realtime, groups/channels, media and administration behind explicit interfaces. Do not split shared state mechanically; document ownership and dependencies first.

**Verification performed for this phase:** source-boundary checks confirm the extracted blocks are the original complete script bodies, the Supabase-before-app and app-before-workspace ordering is preserved, both preload hints and service-worker precache entries exist, and the cache version advances. No browser runtime, authenticated multi-account E2E or Vercel Preview test is claimed by this static verification.


## 12. Feature-module extraction — phase 2

Branch: `refactor/modular-app-entrypoints`.

Function declarations have been separated into feature-oriented classic-script modules:

- `modules/core.js`: 17 functions
- `modules/auth.js`: 14 functions
- `modules/notifications.js`: 11 functions
- `modules/conversations.js`: 36 functions
- `modules/messages.js`: 37 functions
- `modules/realtime.js`: 12 functions
- `modules/groups.js`: 15 functions
- `modules/channels.js`: 6 functions
- `modules/admin.js`: 12 functions
- `modules/media.js`: 26 functions

Modules load synchronously before `app.js`, after the Supabase UMD library. The current compatibility boundary is explicit: shared state, Supabase client, DOM helpers, event wiring, auth-state subscription and startup remain owned by `app.js`; feature functions resolve these shared bindings when invoked. This is a controlled migration stage, not yet full dependency injection or independent bundling.

All extracted function bodies are preserved verbatim. Top-level state and initialization side effects remain in `app.js` to avoid changing startup timing. The service-worker shell cache advances to `v19` and precaches every feature module.

No database schema, RLS policy, RPC, storage object, account, or production data was changed. Static checks are required before Preview validation; no browser or authenticated multi-user E2E is claimed.


## 13. Bounded theme-service extraction — phase 3

Branch: `refactor/modular-app-entrypoints`.

Theme preference and browser theme synchronization have been extracted from the main runtime into `modules/theme.js`:

- `themeService` privately owns the local theme preference and `matchMedia` reference.
- It applies the selected theme, synchronizes system-theme changes, and handles cross-tab `storage` events.
- Account-level preference persistence continues through the existing `saveUserSetting` function and existing Supabase settings RPC; no backend contract changed.
- `core.js` retains `applyAppTheme` and `toggleAppTheme` compatibility wrappers, so existing call sites do not need a broad rewrite.
- `app.js` now initializes the service and binds the existing theme button; the old theme preference globals were removed from that file.
- The new script is loaded after `core.js` and before feature modules that may invoke theme/settings functions; it is preloaded and precached.
- The service-worker shell cache advances to `v20`.

This is the first bounded state-ownership extraction, not a full dependency-injection conversion. Static syntax, script-order, preload and precache checks pass. Browser behavior including theme switching, multi-tab synchronization, account preference restore and offline startup still requires Preview smoke testing.