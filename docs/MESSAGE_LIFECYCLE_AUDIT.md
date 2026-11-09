# Message Lifecycle Audit

**Status:** implemented on the isolated engineering branch only. This audit does not mean production has changed or that authenticated end-to-end behavior has been proven.

## Scope

The review follows the message path across the existing static frontend:

1. compose and capture message intent;
2. authenticate the current session;
3. persist a text, attachment, or edit operation;
4. receive database changes through Realtime or fallback synchronization;
5. reconcile shared message state;
6. render replies and signed attachments;
7. update conversation-level delivery/read receipts.

No Supabase schema, migration, RLS policy, RPC, Storage policy, or production setting was changed.

## Root causes addressed

### Async rendering and stale results

- Same-message render attempts are serialized. If an earlier render becomes stale, the queued render retries using the newest row in application state.
- Reply-parent lookups and signed attachment URL creation are followed by conversation/request-token checks before their results are applied.
- Audio signed-URL renewal checks that the original render is still current and the audio element remains connected.
- An obsolete render no longer displays an error toast for the currently active conversation.
- Message loading guards reply-parent results before writing them and checks the request token between auxiliary loaders.

### Conversation and request isolation

- The existing conversation-open token prevents old conversation setup from replacing the active conversation.
- Message rendering, loading and fallback polling use the current message-load version.
- Fallback polling captures its request version before the network request, so a load started during that request invalidates the stale result.

### Fallback synchronization

- The fallback path uses a compound (created_at, id) cursor rather than repeatedly reading only the latest 100 rows.
- It processes up to 200 rows in chronological order per poll and advances the cursor only through successfully reconciled rows. A rendering failure leaves the failed row eligible for retry.
- It also checks edited_at and deleted_at changes since the last successful poll watermark, so edits and deletions made while Realtime is disconnected can be reconciled.
- The watermark is captured before the query and advanced only after a successful pass; changes made during the query remain eligible for the next pass.
- Stable ID ordering handles multiple messages with identical created_at values.

### Browser regression finding: normal send draft retention

- Chromium integration tests exposed a real composer-state bug: when no reply target existed, `state.replyTarget?.id` evaluated to `undefined` while the captured `replyTo` was `null`. The strict comparison prevented the successfully sent draft from clearing.
- The comparison now normalizes the absent reply target to `null` before comparing. This preserves the intended guard against clearing a different reply draft while allowing ordinary non-reply sends to clear correctly.

### Send and edit retry safety

- New messages receive a client-generated UUID before persistence. The existing schema defines chat_messages.id as a UUID primary key with a generated default, so supplying a UUID uses the existing key and requires no migration.
- The pending message ID and uploaded attachment path are retained in memory for the same conversation/user/draft. A retry reuses the same ID and does not upload the same file again.
- If an insert response is ambiguous, the client checks for that exact message ID, conversation and sender before deciding persistence failed. It does not blindly create a second message.
- If an edit RPC response is ambiguous, the client checks the row and accepts the operation only when the requested content is present and the edit revision advanced beyond the expected revision.
- Composer state is cleared only when it still matches the exact draft/reply/edit that was sent. The send lock is released in a finally block.

### Delivery/read receipts and permissions

- Receipt writes for one conversation are serialized within the current browser session to avoid out-of-order completion regressing the local timestamp.
- Receipt results are applied to the UI only if the same user, conversation and request version remain active.
- Group-only-admin send restrictions are respected by the composer button, polling recovery and voice-recording entry point as well as by the send handler.

## Automated regression checks

The regression gate has two layers:

### Source-contract suite

- Uses Node.js built-in modules only.
- Parses every inline JavaScript block in the static application entry point.
- Checks chronological ordering, render serialization, stale-token rejection, polling cadence, receipt serialization, cursor-based fallback reconciliation, retry-safe IDs and group-only-admin restrictions.

### Chromium browser integration suite

- Uses Playwright and Chromium, installed only inside the GitHub Actions runner with `npm install --no-save --no-package-lock`. No package manifest or lockfile is added to the repository.
- Executes the actual `sendMessage` and `renderMessage` function definitions extracted from `index.html` in an isolated browser page with a minimal DOM and a deterministic fake Supabase client.
- Does not load the production application, call the Supabase project, use credentials, or access real user data.
- Covers successful send and draft clearing, ambiguous committed insert recovery without a duplicate, attachment retry with the same ID and one upload, preserving a new draft typed during a pending send, group-only-admin send blocking, stale render-token rejection, and same-ID render serialization/retry.

The browser tests exposed a real defect in the draft-clear guard: an absent reply target evaluated to `undefined`, while the captured no-reply value was `null`. The strict comparison therefore retained ordinary sent text in the composer. The guard now normalizes the missing reply target to `null`; the browser tests verify the corrected behavior.

GitHub Actions runs both layers on branch pushes and pull requests. The current passing run completed 10 source-contract tests and 7 Chromium browser integration tests. This is function-level browser integration with a fake backend, not a full application E2E test against a staging Supabase environment.

## Remaining limits and acceptance gates

1. The pending-send ID map is memory-only. A full page reload loses an unresolved attempt's ID. Durable idempotency across reloads would require a persisted client request ID or a server-side idempotency contract.
2. An uploaded Storage object can remain orphaned if upload succeeds but the message is never persisted and the user abandons the draft. The client deliberately does not delete an object after an ambiguous insert result because the message may already reference it. Safe cleanup needs a server-side reconciliation/retention policy.
3. Receipt serialization is per browser session, not cross-device or cross-tab atomicity. The existing schema stores conversation-level last_delivered_at and last_read_at, not a per-message receipt ledger.
4. The isolated browser suite does not prove full-app DOM behavior, Supabase RLS, actual Realtime delivery, Storage signed URLs, microphone behavior, or backend persistence under real network conditions.
5. Fallback polling processes at most 200 rows per pass. The message-insert cursor can continue through larger new-message backlogs over successive polls, but more than 200 edit/delete updates in one watermark interval is not proven to be exhaustively paged; this needs a dedicated update-stream cursor before claiming unbounded recovery.
6. Before release, run two-account browser tests for direct chats, groups and channels; test equal timestamps, edit/delete during load, switching conversations during attachment signing, network interruption with more than 100 incoming messages, duplicate-send retry, attachment retry, and read/delivery updates.
7. A third non-member account must confirm that backend authorization still blocks unauthorized reads. UI checks are not a security boundary.

No test in this document is a claim of production capacity or a concurrent-user benchmark.
