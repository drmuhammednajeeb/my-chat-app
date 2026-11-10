# Clean Chat Core Rebuild — Engineering Baseline

**Status:** modular client and disposable-local destructive rebuild candidate implemented; final local runtime and Chromium regression gates in progress.  
**Database execution:** disposable local only. No cloud or production DDL is authorized by this document.  
**Data policy:** legacy message rows are disposable. The rebuild does not attempt to restore or migrate old message content.

## 1. Rebuild objective

Establish a deterministic chat core with these guarantees:

1. A message belongs to exactly one conversation and is never rendered into another conversation.
2. A retry of the same send cannot create a duplicate message.
3. Concurrent messages in one or several conversations converge to a stable, repeatable timeline.
4. Reactions are unique per user/message and limited to the six UI-supported types.
5. Stars are private to the acting user and unique per user/message.
6. A user outside a conversation, or an inactive/unverified user, cannot read or mutate its messages, reactions, or stars.
7. Realtime is an acceleration/notification path, never the source of truth. Reconnect always reconciles against PostgreSQL.
8. UI state changes are reconciled with confirmed backend state after ambiguous network outcomes.

## 2. Existing code findings

The current browser source was a 305 KB `index.html` with two large inline application scripts. It has now been extracted, preserving order, into eight classic scripts under `js/`. Each file uses strict mode. The Supabase UMD client remains loaded before the application modules.

The existing send pipeline already has useful reliability behavior:
- client-generated stable UUID per pending send;
- the same ID and uploaded attachment are reused on retry;
- ambiguous insert failures are verified by querying that same message ID;
- draft clearing is conditional on the original draft and conversation still being active;
- rendering is guarded by conversation/request generation.

The existing lifecycle tests already cover send retries, draft preservation, stale render tokens, chronological reconciliation, delete reconciliation, receipt serialization, reactions, and stars.

Two action paths still need hardening:
- **Reactions:** optimistic state is reverted on any write error without first checking whether the database committed the write but the response was lost.
- **Stars:** the write path lacks a per-message in-flight guard and ambiguous-outcome verification.

These are concrete implementation targets; they are not assumptions that the whole message pipeline is broken.

## 3. Database contract

The current deployed catalog was inspected read-only. Core tables and relevant existing fields:

### `conversations`
- `id`, `type` (`direct | group | channel`), `title`, `created_by`, `created_at`, `updated_at`, `last_message_at`
- `description`, `is_public`, `avatar_path`
- Current checks distinguish direct conversations from titled group/channel conversations.

### `conversation_members`
- composite primary key `(conversation_id, user_id)`
- `role` (`owner | admin | member`), `joined_at`, `last_read_at`, `last_delivered_at`

### `chat_messages`
- `id`, `conversation_id`, `sender_id`, `content`, `attachment_path`, `attachment_type`, `reply_to`
- `created_at`, `edited_at`, `deleted_at`, `edit_revision`, `expires_at`
- Existing reply-parent trigger enforces same-conversation, non-deleted reply targets.
- Existing edit guard protects message identity/routing and restricts content changes to secure edit/soft-delete paths.

### `message_reactions`
- `conversation_id`, `message_id`, `user_id`, `reaction_type`, `created_at`
- Current primary key: `(message_id, user_id)`.
- Allowed reaction types: `like, heart, wow, pray, fire, celebrate`.

### `user_message_stars`
- `user_id`, `conversation_id`, `message_id`, `created_at`
- Current primary key: `(user_id, message_id)`.
- Current membership foreign key scopes the star to a conversation member.

## 4. Target integrity improvements

The replacement baseline should preserve the browser-facing contract where it is still needed, while removing avoidable ambiguity:

- Keep message IDs client-generated and stable across retry.
- Add an explicit idempotency key if needed for retry across client reinstalls; enforce it with a unique constraint scoped to sender.
- Add a composite unique key on messages `(conversation_id, id)`.
- Make reaction and star foreign keys reference `(conversation_id, message_id)`, preventing a row from naming a message in a different conversation.
- Keep reaction uniqueness at `(message_id, user_id)`; validate the six allowed values at the database boundary.
- Keep star uniqueness at `(user_id, message_id)`; stars remain private to their owner.
- Index the timeline by `(conversation_id, created_at DESC, id DESC)` and keep cursor pagination on both timestamp and ID.
- Retain server-side active-member, conversation-membership, and role checks. Do not rely on UI checks for authorization.
- Do not grant direct writes to edit-history/audit tables.

The migration must explicitly account for dependent features (pins, edit history, private replies, expiring messages, notifications, attachments, and group settings) before any table is dropped or recreated.

## 5. Conversation isolation and concurrency

- Every message, reaction, pin, and star operation must carry the authoritative `conversation_id`.
- Every realtime callback must validate the active conversation and payload conversation ID before mutating UI state.
- Conversation switching increments a generation token; all in-flight loads and render work from the previous generation become stale.
- Direct-conversation creation must remain atomic and idempotent for both request orders (A→B and B→A).
- Send retries reuse one message ID; no new ID is minted until the previous pending send is resolved or explicitly abandoned.
- Realtime events are deduplicated by stable message/reaction keys; a full database reconciliation closes any event gap after reconnect.

## 6. Realtime design decision

Postgres remains authoritative. The current app uses Postgres Changes subscriptions. The clean rebuild will compare two local-only designs before choosing:

**Option A — Postgres Changes**
- simpler cutover and natural row payloads;
- every subscribed reader must be authorized for each change;
- appropriate if measured connected-user and event volume remain modest.

**Option B — private per-conversation Broadcast**
- topic format `conversation:<uuid>:messages`;
- topic access requires active membership;
- database trigger emits compact, explicit event payloads;
- clients still fetch/reconcile canonical rows from PostgreSQL after join/reconnect.

The selected design must pass cross-conversation isolation, revoked-membership, inactive-user, reconnect-gap, duplicate-event, and concurrency tests. Never create/alter objects in Supabase's protected `realtime` schema; use supported Realtime functions and policies only.

## 7. Security contract

- RLS enabled on every exposed application table.
- Explicit Data API exposure and role grants for new tables; new public tables are not assumed to be automatically exposed.
- `anon` receives no application-table access.
- `authenticated` receives only the required table/column privileges.
- Every policy combines the authenticated role with an actual active-membership/ownership predicate.
- UPDATE policies include both `USING` and `WITH CHECK`.
- `SECURITY DEFINER` helpers live in `app_private`, use an empty/fixed search path, fully qualified names, and narrowly scoped EXECUTE grants.
- Never trust user-editable JWT `user_metadata` for authorization.
- Storage object paths are validated against the authenticated uploader and conversation membership.

## 8. Acceptance tests — mandatory before cutover

### Message persistence
- one send → one database row → one visible message;
- ambiguous committed insert → same ID verified, no duplicate;
- failed insert → retry same ID and attachment path;
- two users send concurrently in one conversation;
- two conversations receive interleaved concurrent sends with zero cross-render;
- same timestamp rows sort deterministically by ID;
- pagination boundary has no duplicates or gaps;
- edit/delete/reply/expiry behavior remains valid.

### Reactions
- each of six types persists;
- one user has at most one reaction per message;
- switching type is one upsert, selecting the same type removes it;
- repeated clicks and concurrent requests cannot leave stale local state;
- ambiguous write outcome is verified before rollback;
- cross-conversation and inactive-user reads/writes are denied.

### Stars
- star/unstar is idempotent;
- one user cannot read another user's stars;
- stars are constrained to messages in the stated conversation;
- ambiguous response is verified;
- rapid repeated actions are serialized or safely rejected while pending.

### Realtime
- insert/update/delete/reaction events reconcile exactly once;
- unrelated conversation events do not affect the active timeline;
- reconnect fetches authoritative state and fills event gaps;
- membership revocation blocks subsequent reads and topic access.

### Browser and load
- Chromium end-to-end tests with two authenticated users;
- mobile viewport and touch interaction for reaction controls;
- 24 reversed-pair direct-conversation requests converge to one row;
- concurrent authenticated message writes persist uniquely;
- then progressively test 100, 500, and 5,000 simulated users; do not infer production capacity from small local tests.

## 9. Implemented disposable-local candidate

The current rebuild branch now contains an explicitly test-only destructive fixture:
- `tests/staging/local-supabase/fixtures/clean-chat-core-rebuild.test-only.sql`
- `tests/staging/local-supabase/clean-chat-core-runtime.mjs`

The fixture is not a canonical migration and is not part of the historical replay manifest. It is invoked only by the runtime runner after the runner validates a loopback PostgreSQL URL and the test-only GUC. It truncates `public.conversations CASCADE` (thereby clearing conversation-dependent data) while preserving `auth.users` and `public.profiles`. The Node runner then removes orphaned objects from `chat-media`, `conversation-documents`, and `channel-avatars` through the supported local Storage API using the local service-role key, and verifies each bucket is empty. The public `avatars` bucket used by profile images is preserved. Direct SQL mutation of `storage.objects` is prohibited by Supabase and is not used.

It then adds:
- canonical `direct_user_low/direct_user_high` columns, a pair check, and a unique partial index;
- a direct-conversation RPC that checks active/verified eligibility, takes an advisory transaction lock, and relies on the unique index as the final invariant;
- composite conversation/message foreign keys for reactions, stars, pins, and private reply contexts;
- a stable conversation timeline index.

The local acceptance runner exercises symmetric direct-conversation identity, duplicate message-ID rejection, direct/group timeline isolation, shared reactions, owner-private stars, inactive-user denial, invalid reaction rejection, star impersonation denial, and cross-conversation foreign-key rejection. The same runtime job repeats the 24-request reversed-pair and 40-write concurrency test after the reset.

This candidate is still under CI validation. It must not be copied to a hosted project or treated as production-ready until the complete runtime result and subsequent authenticated staging gates pass.

## 10. Cutover and destructive reset

A clean reset is permitted because old message data is explicitly disposable. The reset is still staged:

1. Build the canonical schema and RLS in a disposable local Supabase stack.
2. Replay from an empty database and run the full acceptance suite.
3. Compare the new catalog with the frontend contract and audit every dependent feature.
4. Run authenticated Staging E2E and load tests on an isolated staging target.
5. Prepare one reviewed, reversible deployment plan with a verified backup/restore point.
6. Only after a separate explicit cutover approval, drop/recreate the approved application tables and apply the new baseline to the existing `my-chat-app` Supabase project.
7. Verify Auth, profiles, Data API exposure, Realtime, Storage, message send/receive, reactions, stars, and permissions before routing users to it.

No operation in this document authorizes touching the separate store project.

## 11. Current Supabase platform constraints

- Supabase CLI v3 changed database commands to local-by-default; hosted changes require explicit `--remote` and confirmation behavior. Existing CI currently pins the CLI, so keep it pinned until a dedicated v3 migration is tested.
- New public tables are no longer assumed to be exposed automatically through the Data API; exposure and grants must be explicit.
- Realtime documentation recommends evaluating Broadcast for scale and notes that Postgres Changes authorization work grows with subscribed readers. The final choice must be based on the app's local benchmarks, not preference.

References:
- https://supabase.com/changelog/cli-v3-local-by-default
- https://supabase.com/changelog/tables-not-exposed-by-default
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/realtime/authorization
