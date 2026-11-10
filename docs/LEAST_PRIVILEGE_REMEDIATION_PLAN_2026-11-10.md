# Least-Privilege Remediation Plan — 2026-11-10

**Project:** `my-chat-app`  
**Environment reviewed:** existing Supabase production project, read-only catalog inspection  
**Change status:** no production grant, policy, bucket, schema, or data change was performed.

## 1. Verified live catalog baseline

### Public tables and RLS

- 24 base/partitioned public tables were observed.
- RLS is enabled on all 24.
- `FORCE ROW LEVEL SECURITY` is disabled on all 24. Table owners and elevated roles can therefore bypass RLS; application access must be evaluated as the actual API roles.
- RLS does not restrict PostgreSQL table-level `TRUNCATE`, `REFERENCES`, or `TRIGGER` privileges.

### Broad table grants

Read-only inspection found broad privileges on these tables:

| API role | Tables with broad table grants | Count |
|---|---|---:|
| `anon` | `chat_list_items`, `chat_lists`, `conversation_documents`, `conversation_group_settings`, `conversation_member_events`, `private_conversation_notes`, `private_reply_contexts`, `user_classification_rules`, `user_conversation_classifications`, `user_conversation_label_items`, `user_conversation_labels`, `user_conversation_settings`, `user_message_stars` | 13 |
| `authenticated` | The same 13 tables plus `user_settings` | 14 |

The broad grants observed include combinations of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER. In particular, `TRUNCATE`, `REFERENCES` and `TRIGGER` are not governed by row-level policies.

Other tables have narrower, explicitly granted privileges; those must be retained only where required by the client contract.

### Default privileges — critical

The current `public` schema default ACLs for both object creators `postgres` and `supabase_admin` include:

| Object type | Default privileges granted to `anon` and `authenticated` |
|---|---|
| Tables | `arwdDxtm` — broad DML plus TRUNCATE, REFERENCES, TRIGGER and PostgreSQL 17 MAINTAIN |
| Sequences | `rwU` — SELECT, UPDATE and USAGE |
| Functions | `X` — EXECUTE |

The production role inventory confirms `postgres` is not a member of `supabase_admin`; `supabase_admin` is a separate superuser. All 24 public tables, 20 public functions, and 2 public sequences inspected are owned by `postgres`. Therefore the actionable application default-ACL target is `postgres`. The local-only overlay must not attempt to alter `supabase_admin` defaults or grant role membership to `postgres`; it instead asserts that public application objects remain owned by `postgres` and leaves platform-owned defaults untouched.

### Function execution ACLs

The live catalog shows:
- `public.guard_chat_message_content_update()` has EXECUTE granted to PUBLIC, `anon`, and `authenticated`, despite being a trigger implementation function.
- `app_private.guard_conversation_member_update()` has EXECUTE granted to PUBLIC.
- `app_private.enforce_chat_message_reply_parent()` is also executable by `authenticated` and must be classified as a trigger implementation before finalizing the allowlist.
- Public RPCs used by the client and authenticated app_private helpers must be preserved deliberately; do not blanket-revoke every function from `authenticated`.

The test-only overlay now removes PUBLIC/API-role EXECUTE from trigger-returning functions in `public` and `app_private`, then asserts that none remain directly executable by `PUBLIC`, `anon`, or `authenticated`. This must pass in disposable local Supabase before the proposed production migration is drafted.

### Sequences

The read-only inventory observed USAGE grants for `anon` and `authenticated` on:
- `public.conversation_member_events_id_seq`
- `public.messages_id_seq`

Sequence ACLs must be checked separately from table ACLs. The legacy `messages` sequence must not be removed until its dependencies and migration history are retired.

### Storage

The live Storage bucket inventory is:

| Bucket | Public delivery | Intended access posture |
|---|---|---|
| `avatars` | Public | Public reads are intentional; writes remain owner-scoped |
| `channel-avatars` | Private | Conversation-admin/member policy |
| `chat-media` | Private | Conversation member access |
| `conversation-documents` | Private | Owner/shared-member access |

The current `Conversation members upload chat media` INSERT policy checks bucket and conversation membership but does not bind path segment 2 to `auth.uid()`. The test-only candidate adds that condition. Do not apply it to production until Storage API tests prove legitimate upload/upsert/read/delete behavior and reject cross-user path spoofing.

## 2. Proposed least-privilege target

### A. Default ACL policy

For every application object-creation role in `public` (currently verified: `postgres` and `supabase_admin`):

- Default table privileges: revoke from `PUBLIC`, `anon`, and `authenticated`.
- Default sequence privileges: revoke from `PUBLIC`, `anon`, and `authenticated`.
- Default function EXECUTE: revoke from `PUBLIC`, `anon`, and `authenticated`.
- Add explicit per-object grants in each new migration only after the application contract has been verified.
- Preserve service-role and owner privileges; do not apply blanket changes to platform-managed roles.

### B. Existing table privileges

- Remove all direct table privileges from `anon` on application-owned public tables.
- Remove `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17 `MAINTAIN` from `authenticated`.
- Retain only required SELECT/INSERT/UPDATE/DELETE and column-level UPDATE privileges.
- Preserve `UPDATE` where PostgREST uses `ON CONFLICT DO UPDATE` (the local compatibility test specifically exercises `chat_list_items` and `user_message_stars`).
- Keep `message_edit_history` policy-gated INSERT for `edit_message_secure`; do not grant direct UPDATE/DELETE.
- Keep `conversation_member_events` read-only to clients if event writes are trigger/RPC-owned.
- Remove direct UPDATE/DELETE from `private_reply_contexts` if confirmed not to be part of the browser contract.
- Retain owner-scoped CRUD for `chat_lists` and `chat_list_items` as verified by rollback-only local tests.

### C. Function EXECUTE policy

- Revoke direct EXECUTE from PUBLIC/anon/authenticated on trigger-returning implementation functions; triggers themselves continue to execute through their installed trigger bindings.
- Revoke PUBLIC and anon EXECUTE from application RPCs by default.
- Maintain an explicit allowlist for client-facing `public` RPC wrappers.
- Maintain an explicit allowlist for `app_private` helpers that are intentionally called from RLS expressions or authorized RPC wrappers.
- Require every SECURITY DEFINER function to have a fixed empty `search_path`, a reviewed owner, explicit authorization checks, and minimal EXECUTE grants.
- Do not assume a function is safe merely because its schema is named `app_private`.

### D. RLS and membership

- Preserve RLS on every application table.
- Preserve feature-specific ownership and conversation-membership predicates.
- Keep active-membership enforcement as an additional restrictive policy only after the local CRUD matrix proves it does not break intended behavior.
- Check both USING and WITH CHECK conditions for each command.
- Test two active members, an inactive member, an unverified member, and an unrelated user.
- Do not turn on FORCE RLS indiscriminately; evaluate owner, trigger, SECURITY DEFINER, service-role, and maintenance paths first.

### E. Storage

- Preserve public avatar delivery and private status of the other three buckets.
- Bind `chat-media` uploader path segment 2 to `auth.uid()` while retaining conversation membership.
- Keep document paths bound to owner ID and conversation ID.
- Keep channel-avatar write paths restricted to authorized channel administrators.
- Test the actual Storage HTTP API, not only direct SQL policy evaluation.

## 3. Disposable-local test coverage

The existing local-only overlay and assertions already test:
- RLS enabled and active-member policy coverage.
- No anon table privileges and no authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
- No direct public sequence access.
- No public function EXECUTE for anon/PUBLIC.
- No unsafe default ACLs for the checked migration owner.
- No API-role direct access to `app_private` tables.
- SECURITY DEFINER search_path and execute ACL.
- Storage bucket visibility, avatar owner policies, and chat-media path ownership.
- Rollback-only CRUD/upsert compatibility for chat lists, stars, message edits, and cross-user isolation.

The new security branch extends this coverage to:
- Trigger function EXECUTE ACLs across `public` and `app_private`.
- Local platform preflight verification that `supabase_admin` exists, while explicitly leaving its platform-owned default ACL untouched.
- A catalog assertion that public application tables, sequences, and functions are owned by the approved `postgres` migration role.

**The updated branch has not yet passed CI.** Do not treat these added checks as verified until the workflow completes successfully.

## 4. Production change sequence — not yet authorized

1. Finish source reconciliation for all 59 remote migration records.
2. Complete the API privilege contract: every table/column/sequence/function grant mapped to a real client query, RPC, trigger, or platform operation.
3. Extend the disposable local overlay to both migration owners and all object types; run complete CRUD/RPC, Auth, Storage, and Realtime tests.
4. Rehearse a clean local replay and compare catalog snapshots.
5. Prepare a narrowly scoped additive production migration with preconditions, postconditions, and rollback/recovery instructions.
6. Test the exact migration against a staging target or an approved disposable branch environment; verify app sign-in, messages, notifications, uploads, realtime, and admin flows.
7. Capture and verify a recoverable backup and a restore rehearsal.
8. Obtain explicit approval for a production maintenance window and apply only the reviewed migration.

## 5. Hard stop conditions

Stop and do not deploy if:
- Any of the 59 migration records lacks a documented source/recovery classification.
- A client query fails after privilege reduction.
- Any expected RPC loses EXECUTE or any trigger fails.
- A legitimate Storage operation is denied or cross-user access succeeds.
- Realtime delivery, message ordering, or membership isolation regresses.
- The database owner/default ACL inventory changes unexpectedly.
- Backup/restore has not been rehearsed.

**Current production status:** read-only. No grants, policies, buckets, tables, functions, sequences, migrations, or data were changed.
