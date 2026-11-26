# Message Loading & Rendering Controller — Stage 7

## Scope

The existing `modules/message-loader.js` already owns the initial 50-message fetch, authoritative timeline reconciliation, rollback on incomplete rendering, and optional metadata enrichment. Stage 7 completes that boundary by moving older-history pagination and render de-duplication into the same controller.

## Ownership

- Initial message fetch and reconciliation.
- Older-message cursor pagination (50 rows per page).
- Stable chronological ordering and ID-based de-duplication.
- Preservation of newer realtime edits/tombstones during fetch reconciliation.
- Per-message in-flight render coalescing.
- Request-generation and active-conversation guards before asynchronous commits.
- Rollback of a failed or cancelled older-history page without deleting rows owned by a newer timeline commit.

The DOM-specific message renderer, Supabase query construction, realtime subscription lifecycle, polling schedule, receipts, and message actions remain injected application dependencies. No database schema, migration, RLS, Storage, or production data changes are part of this stage.

## Integration

`index.html` keeps thin compatibility adapters for `loadMessages`, `loadOlderMessages`, and `renderMessage`. The module is loaded before the inline application script. Hidden-message visibility remains checked by the application adapter before rendering.

## Validation

Run `node tests/message-loading-rendering-controller.test.js` and `node --check modules/message-loader.js`. The dedicated GitHub Actions workflow also checks that pagination rollback and render de-duplication no longer live in the inline application script.

## Browser acceptance still required

- Open a conversation with more than 50 messages and load multiple history pages.
- Verify equal-timestamp messages remain in deterministic ID order.
- Switch conversations while initial/history fetches are pending.
- Trigger realtime inserts/edits while a history page is rendering.
- Verify scroll anchoring remains stable and no message is duplicated.
- Close/archive a conversation during pending loads and confirm stale results do not mutate the active timeline.