# Supabase Dependency Inventory — 2026-11-25

> Read-only source audit against main commit 7b845bdb5ba3cae44b6c7c4c177d0293147f3ab5. This inventory is partial and targeted; it is not an exhaustive search of every inline script or migration. No runtime code, production configuration, schema, or data was changed.

## Confirmed frontend coupling

| Area | Evidence observed in source | Replacement capability needed | Priority / risk |
|---|---|---|---|
| Runtime configuration | `modules/runtime-config.js` validates Supabase project URL/key and production host allowlist; app boot in `index.html` uses deployment config | Environment configuration for independent API origin and client-safe configuration | P0; config and deploy coupling |
| SDK/bootstrap | `index.html` loads Supabase JS UMD CDN and creates `supabaseClient` | API client adapter, auth/session bootstrap and graceful boot failure | P0; pervasive runtime dependency |
| Chat timeline | `modules/message-loader.js` reads `chat_messages` via Supabase query API | API pagination, edits/deletes/tombstones, reconciliation, receipts, timeline ordering | P0; core functionality |
| Reactions | `modules/message-reactions.js` reads/inserts/deletes `message_reactions` | Authorized reaction CRUD + uniqueness and idempotency | P1 |
| User settings | Inline app code reads `user_settings` and calls `patch_my_user_settings` RPC | Settings endpoint and validated patch semantics | P1 |
| Notifications | Inline code queries `user_notifications` and unread counts | Notification API, read state, pagination | P1 |
| Conversation image/media | `modules/profile-status-and-conversation-images.js` uses Storage signed URLs, uploads/removals and `set_conversation_image` RPC; listens to conversation changes | Authenticated upload/download flow, media ownership/cleanup, event delivery | P1 |
| Status media/feed | `modules/status-workspace.js` queries `profile_statuses`, uploads/deletes objects and requests signed URLs | Status API, expiry rules, media storage and feed/events | P1 |
| Personal backup/restore | `modules/backup-restore.js` queries several personal tables through Supabase client and restores rows | Export/import endpoints with explicit ownership, allowlists, validation and transactional restore | P2; sensitive and destructive restore surface |
| Auth | App bootstrap uses Supabase client auth/session (visible in inline source configuration) | Identity provider or first-party auth, secure cookie/session handling, recovery and authorization | P0; high security and migration risk |
| Realtime | Conversation-image and status modules use Supabase channels/realtime; broader use must be mapped | WebSocket/SSE, reconnect, event authorization, sequencing and consistency | P1; correctness risk |
| Database / policies / RPC | 80 paths under `supabase/` in the main tree; existing migrations and functions are legacy source artifacts | PostgreSQL schema, service API, explicit authorization tests, migration provenance | P0; do not delete or rewrite during inventory |

## Safe migration order (dependency-aware)

1. Complete repository-wide API/RPC/table/storage/realtime/auth inventory and trace inline scripts.
2. Establish target PostgreSQL schema and authorization model; write threat model and regression tests.
3. Build isolated Docker Compose backend + API + PostgreSQL, test-only fixtures, no production secrets.
4. Implement identity/session and authorization before chat data endpoints.
5. Implement chat read/write, pagination, lifecycle and regression behavior.
6. Implement realtime/event layer and reactions, receipts, notifications.
7. Implement media storage abstraction and migration rehearsal.
8. Implement settings, backup/export/restore with transaction and ownership tests.
9. Add frontend adapter behind a feature flag; preserve current production path until staged acceptance.
10. Run synthetic migration/rollback rehearsal, compare data integrity, obtain explicit cutover approval.

## Safety controls

- No production database/schema/data writes, deployment, destructive migration, or PR merge as part of this audit.
- Keep legacy assets and migration history intact until verified cutover and rollback.
- Docker tests in hosted CI are ephemeral and do not constitute a persistent backend deployment.
- GitHub Pages is static hosting; the independent API requires a separate host/runtime.
- Findings above are source observations, not evidence of a live production test.
