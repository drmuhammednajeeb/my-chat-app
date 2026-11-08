# Runtime Architecture Audit — 2026-11-08

## Scope and safety boundary

- Repository: `drmuhammednajeeb/my-chat-app`
- Pull request: #72 (`refactor/modular-app-entrypoints-mainline`)
- Audited head before this report: `b3056c351fbd54e59c19934b61652c849209ae9b`
- Base: `main` at `66e4c2a7efd980e622768260da2eccf2baf868c7`
- This audit changes no runtime code, database objects, Supabase configuration, RLS policies, RPCs, or production data.

## Current runtime layout

The preview loads classic scripts in this order:

1. Supabase UMD
2. `modules/core.js`
3. `modules/auth.js`
4. `modules/notifications.js`
5. `modules/conversations.js`
6. `modules/messages.js`
7. `modules/realtime.js`
8. `modules/groups.js`
9. `modules/channels.js`
10. `modules/admin.js`
11. `modules/media.js`
12. `app.js`
13. `workspace.js`
14. `membership.js`

The current implementation intentionally uses global function declarations and shared state rather than ES module imports/exports. Therefore the findings below describe runtime coupling, not native ES-module import cycles.

## Preliminary static dependency findings

A source scan matched function declarations to same-name call expressions across files. It found:

- 42 distinct cross-file dependency directions.
- 198 cross-file call-site matches.
- One large strongly connected runtime dependency component involving 9 files:
  `workspace.js`, `modules/conversations.js`, `modules/core.js`, `modules/messages.js`, `modules/groups.js`, `modules/media.js`, `modules/realtime.js`, `modules/channels.js`, and `modules/admin.js`.
- `modules/auth.js` and `modules/notifications.js` also call into several other feature files; the preliminary graph did not place them in that same strongly connected component.

The scanner is deliberately conservative and regex-based. Matches can include calls in comments, strings, or nested contexts. Treat the counts and graph as a dependency-discovery baseline, not as a compiler-grade call graph. Confirm each proposed edge against its actual function body before changing code.

## Main architectural risks

1. **Shared global runtime:** feature files can call functions in other files directly, so file boundaries do not enforce ownership.
2. **Conversation/message/realtime coupling:** these features call into each other in both directions, increasing regression risk around load, render, polling, and state updates.
3. **Workspace coupling:** workspace functions depend on conversation and message functions, while those feature files call back into workspace functions.
4. **Core is not yet a leaf layer:** `modules/core.js` calls a message-layer function (`markConversationReceipt`), while message functions call core utilities.
5. **Feature boundaries are mixed:** conversation code invokes admin, channel, media, group, workspace, realtime, and message behavior.

## Recommended remediation sequence

### Phase A — establish enforceable baseline
- Preserve this report as the baseline.
- Add a repeatable static dependency audit that distinguishes declarations, direct call sites, and script load order.
- Classify each cross-feature call as: shared primitive, state/query, command/action, render callback, or lifecycle orchestration.
- Do not fail the build on existing edges until the baseline has been reviewed and approved.

### Phase B — remove the highest-risk cycles incrementally
1. Make `core` a true shared-primitives layer; move message-specific behavior out of core.
2. Introduce narrow callback/adapter seams for conversation ↔ messages and messages ↔ workspace.
3. Move realtime event handling to publish normalized events; feature modules consume them rather than calling each other's render internals.
4. Separate orchestration from feature ownership so `app.js` coordinates features without becoming a second implementation layer.
5. Reassess group/channel/admin/media dependencies after each seam is tested.

### Phase C — verification gates
For every small change:
- Run syntax checks for every changed JavaScript file.
- Run dependency audit and compare against this baseline.
- Verify script ordering and service-worker precache parity.
- Verify no duplicate global function or lexical declarations.
- Test authenticated preview flows on desktop and mobile before considering merge.
- Revert immediately if startup, navigation, message ordering, scroll, media, or permissions regress.

## Explicitly deferred issue

Message swipe/reaction interaction remains deferred. Do not change its pointer-event or CSS implementation as part of this architecture pass. Revisit it separately with event-path and computed-style diagnostics after the dependency boundaries are better understood.

## Merge policy

PR #72 remains Draft and must not be merged until the user explicitly approves after functional preview testing. Production and Supabase remain untouched.

## Progress update — first dependency seam

After recording the baseline, the first low-risk ownership correction was applied:

- Moved `clearNewMessages()` and `jumpToLatestMessages()` from `modules/core.js` to `modules/messages.js`.
- Preserved both function names and bodies; call sites and user-facing behavior were not intentionally changed.
- `modules/core.js` no longer calls message-layer functions.
- The same conservative scan now reports 41 distinct module dependency directions (down from 42), and the strongly connected component is reduced from 9 files to 7. `modules/core.js` is no longer part of that component and has no outgoing cross-module function calls in this scan.
- Structural checks confirmed the two functions exist only in `modules/messages.js`, no duplicate function declarations were detected in the checked files, and braces are balanced in both changed files.
- Vercel reported the latest preview deployment as Ready. This is a deployment/build signal, not authenticated end-to-end browser validation.

Next: inspect the remaining 7-file cycle and select one similarly narrow seam. Keep this PR Draft and do not merge until functional preview validation and explicit approval.
