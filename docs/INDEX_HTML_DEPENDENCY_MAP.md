# index.html — Dependency Map & First Extraction

## Stage 2 / Pilot: authentication validation helpers

**Extracted:** pure signup-name normalization, signup-name validation, and password-strength scoring to `modules/auth-validation.js`.
**Retained in inline script:** compatibility wrappers and the DOM-facing `updatePasswordStrength()`.
**Script ordering:** the new classic script loads before the main inline script and publishes a frozen `window.BizmindAuthValidation` API.
**Scope:** no DOM, Supabase, database, RPC, storage, realtime, or CSS behavior inside the extracted module.

### Dependency contract

| Helper | Inputs | Outputs | Dependencies / side effects |
|---|---|---|---|
| `normalizeSignupDisplayName` | arbitrary value | normalized NFC string, trimmed, whitespace collapsed | pure |
| `validateSignupDisplayName` | string-like value | normalized value + validity boolean | pure; calls normalization |
| `getPasswordStrength` | string-like value | numeric level + Arabic label | pure |
| `updatePasswordStrength` (not extracted) | auth DOM | updates meter attributes/classes/text | DOM helper `$`, meter DOM nodes |

### Regression checks added

`tests/auth-validation.test.js` covers normalization, two/three-part names, invalid single/four-part names, and password-strength edge cases.

**Execution status:** tests authored; not executed in this environment. Do not interpret test presence as a pass.

## Broader inline script inventory (static regex scan)

The 2,954-line, approximately 307 KB inline script yielded 213 named function declarations in a basic static scan. Function clusters and indicative members:

- **Bootstrap/shared state:** Supabase client, `$`, shared state, globals, lifecycle, telemetry.
- **Auth/profile:** `setAuthMode`, signup validation, reset flow, `ensureProfile`, `enterApp`, avatar handling.
- **Directory/presence:** `loadDirectory`, `renderDirectory`, `startPresence`, search normalization.
- **Conversation list:** `loadConversations`, `renderConversations`, direct chat preferences, archive.
- **Message core:** `openConversation`, `loadMessages`, `renderMessage`, `sendMessage`, edit/delete/reply/pin, polling/realtime and timeline reconciliation.
- **Notifications:** load/render/read state and realtime subscription.
- **Groups/channels:** creation, membership, settings, moderation, invites.
- **Team administration:** dashboards, member roles, group management.
- **Workspace:** categories, labels, rules, private notes, documents, private group replies.
- **Diagnostics/performance:** `recordPerf`, `performanceSummary`, `diagLog`, hit-testing, polling/realtime diagnostics.

### Common dependency surface

Most feature clusters currently depend on one or more of the following implicit contracts: `state`, `supabaseClient`, `$`, `toast`, `esc`, `time`, `initials`, `renderAvatar`, DOM IDs, global event handlers, and module instances. The scan does not reliably resolve reads/writes, call graphs, SQL/RPC or DOM selector dependencies; this is an initial inventory, not an AST-complete dependency graph.

## Next extraction gates

1. Verify the pilot in CI or a Node environment (including script ordering and tests).
2. Add a minimal static check that the extracted API script loads before inline consumers and that compatibility wrappers remain.
3. Continue with another pure helper boundary before touching conversation/message core.
4. Keep auth submission, membership verification, profile lifecycle and Supabase interactions in the inline controller until explicit dependencies and tests are established.
5. Never merge this pilot without review and execution of the checks.
