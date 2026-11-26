# index.html Decomposition — Baseline Audit

## Guardrails
- This audit and pilot branch is isolated from `main`.
- No production database changes or migrations.
- Preserve current DOM IDs, event behavior, auth/session behavior, message/realtime semantics, and CSS ordering.
- Move code only after dependency mapping, tests, and a reversible boundary are established.

## Verified observations from current `main`
- `index.html` contains app shell, dialogs/panels, notification center, boot/auth markup, boot-theme code, and a large main inline JavaScript block.
- Modules loaded before the main inline script include deployment/runtime config, message loader, reactions, voice recorder, audio player, updater, auth-error messages, auth-light, and runtime-config.
- The inline main script creates the Supabase client, global DOM helper `$`, shared `state`, telemetry/performance helpers, and UI logic.
- Dependencies include shared `state`, `supabaseClient`, `$`, `toast`, `esc`, `time`, `initials`, DOM elements, modules and inline handlers.
- Inline code spans auth/signup, notifications, profile/avatar, sidebar/directory, conversation and message workflows, composer, diagnostics, group/channel, team administration, workspace/settings and other feature logic. Boundaries require further mapping.

## Incremental, reversible strategy
1. **Inventory/dependency map:** identify function blocks, globals read/written, DOM IDs, tables/RPCs, event registration and contracts. No code move yet.
2. **Test harness:** static boundary/script-order/API checks and tests for the selected extraction.
3. **Pilot:** choose a narrow feature with explicit dependencies and reversible boundary.
4. **Incremental extraction:** one controller per stage; avoid broad refactors or simultaneous DOM/CSS/database changes.
5. **Contract stabilization:** reduce implicit globals gradually and define explicit dependencies.
6. **Markup reduction:** only after JS extraction, separately move markup/templates if appropriate; preserve selectors and accessibility.

## Candidate sequence (after further dependency mapping)
- Theme/PWA install controller (verify settings and storage dependencies).
- Notification center (state/realtime/read interactions; medium coupling).
- Diagnostics/performance telemetry (event listeners and global observers; inspect teardown/privacy).
- Directory/search (profile, presence and conversation coupling).
- Team dashboard/admin (database/RPC dependencies).
- Conversation/message core: defer until contracts and tests are stronger; highest risk.

## Extraction gate
- Before/after dependency inventory.
- CI tests pass or limitations documented.
- No database/schema/production changes.
- Verify startup/session, message ordering, realtime/polling, composer, mobile navigation and accessibility.
- Keep PR focused and reviewable.
