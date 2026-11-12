# Client PostgREST and Storage Access Inventory — 2026-11-10

**Source:** static scan of `index.html` on `main` at `92d6cc8203ea2d587e9b456d7aca7724be974d5e` (blob SHA `f52cff535eda8f020f0e1d93f6a5ca1524a34ca0`).  
**Purpose:** establish the browser client's direct table, Storage, and RPC surface before designing least-privilege grants.  
**Limit:** static source inventory only. It is not a runtime trace, and dynamic query variables may require manual inspection. Occurrence counts are source call-site counts, not request volumes.

## 1. Direct table access

The browser source contains 23 distinct `.from('table')` targets.

| Table | Observed browser operations | Call sites | Privilege-design note |
|---|---|---:|---|
| `chat_list_items` | SELECT, UPSERT, DELETE | 3 | UPSERT conflict path requires the exact INSERT/UPDATE contract; preserve the owner-scoped key. |
| `chat_lists` | SELECT, INSERT, UPDATE, DELETE | 4 | Owner-scoped CRUD. |
| `chat_messages` | SELECT, INSERT, UPDATE | 18 | No direct `.delete()` call was found in the static scan; message deletion appears to use update/soft-delete paths. Verify every update column and RPC path before revoking DELETE. |
| `conversation_documents` | SELECT, INSERT, UPDATE, DELETE | 4 | Metadata CRUD must remain aligned with Storage object owner/share rules. |
| `conversation_group_settings` | SELECT, UPSERT | 2 | UPSERT conflict key is `conversation_id`. |
| `conversation_member_events` | SELECT | 1 | Browser read path only; writes should remain trigger/RPC-owned unless another trusted client is found. |
| `conversation_members` | SELECT, INSERT, UPDATE, DELETE | 14 | High-risk membership table. Preserve only intended columns/rows; updates include read/delivery state and group administration flows. |
| `conversations` | SELECT, INSERT, UPDATE | 3 | Channel creation uses RPCs; direct insert observed for groups. |
| `message_edit_history` | SELECT | 1 | Secure edit writes are via `edit_message_secure`; direct INSERT must remain denied. |
| `message_pins` | SELECT, INSERT, DELETE | 3 | Conversation-scoped pin operations. |
| `message_reactions` | SELECT, UPSERT, DELETE | 3 | Conflict target `message_id,user_id`; keep conversation membership checks. |
| `private_conversation_notes` | SELECT, INSERT, UPDATE, DELETE | 4 | User-owned and conversation-scoped private notes. |
| `private_reply_contexts` | SELECT, INSERT | 2 | Insert/read only in browser source; no direct update/delete call found. |
| `profiles` | SELECT, INSERT, UPDATE | 13 | Profile creation/update flows interact with membership triggers; membership-controlled fields must remain protected. |
| `user_chat_preferences` | SELECT, UPSERT | 3 | Conflict target `user_id,conversation_id`; user and conversation membership scope. |
| `user_classification_rules` | SELECT, INSERT | 2 | User-owned rule creation/read. |
| `user_conversation_classifications` | SELECT, UPSERT, DELETE | 4 | User-owned per-conversation classifications. |
| `user_conversation_label_items` | SELECT, UPSERT, DELETE | 3 | User-owned label assignment join table. |
| `user_conversation_labels` | SELECT, INSERT | 2 | User-owned label creation/read. |
| `user_conversation_settings` | SELECT, UPSERT | 3 | Conflict target `user_id,conversation_id`; user-owned notification/favorite settings. |
| `user_message_stars` | SELECT, UPSERT, DELETE | 3 | A dynamic query variable is used for UPSERT/DELETE; static chaining undercounts these methods. |
| `user_notifications` | SELECT, UPDATE | 4 | Recipient-scoped reads and read-state updates. |
| `user_settings` | SELECT | 1 | Browser reads directly; writes are routed through `patch_my_user_settings` RPC. |

## 2. Storage API access

Three Storage buckets are referenced directly by the browser:

| Bucket | Browser operations | Required behavioral checks |
|---|---|---|
| `avatars` | Upload with upsert, public URL generation | Owner-only upsert/overwrite; public delivery remains intentional; cross-user overwrite denied. |
| `chat-media` | Upload, create signed URL | Uploader folder must match `auth.uid()`; conversation members may read according to membership policy; cross-user path spoof denied. |
| `conversation-documents` | Upload, create signed URL, remove | Owner-only upload/delete; private until shared; members may read only after share; non-owner deletion denied. |

The browser uses signed URLs for private media/documents and public URL generation for avatars. Bucket visibility and object policies must be reviewed separately.

## 3. Client-facing RPC surface

The static browser source contains 10 distinct RPC names:

- `create_channel_invite`
- `create_private_channel`
- `edit_message_secure`
- `ensure_self_chat`
- `get_my_membership_state`
- `get_or_create_direct_conversation`
- `get_team_dashboard_stats`
- `join_channel_by_invite`
- `patch_my_user_settings`
- `transfer_group_ownership`

Each RPC needs an explicit signature-level EXECUTE allowlist and independent authorization review. Do not replace this with a schema-wide EXECUTE grant.

## 4. Least-privilege design implications

1. Do not blanket-revoke all authenticated DML and then guess what breaks. Use this inventory to build a per-table/per-operation allowlist, then verify every entry with the actual rollback-only runtime tests.
2. The current local test suite exercises representative CRUD/upsert and cross-user cases, but does not yet prove every operation in all 23 tables. Extend tests for any operation whose grant is proposed for removal.
3. `conversation_members`, `chat_messages`, `conversations`, `profiles`, `conversation_documents`, and `private_conversation_notes` need especially careful review because they contain security-sensitive membership, message, profile, or private-document state.
4. Keep `message_edit_history` direct writes denied; `edit_message_secure` is the browser write path.
5. Keep `user_settings` writes behind `patch_my_user_settings`; do not add direct UPDATE without a code change and test.
6. Keep `conversation_member_events` writes trigger/RPC-owned unless a separate trusted write path is identified.
7. For UPSERT, verify the exact conflict target and both INSERT/UPDATE RLS checks. A successful SELECT or INSERT test alone is insufficient.
8. Verify all direct table operations and RPC wrappers under at least two users, one inactive/unverified user, and one unrelated user.
9. The static scan found no direct table `.delete()` call for `chat_messages`; confirm that the application uses soft-delete/update before removing any DELETE grant.
10. The inventory is a baseline, not proof of runtime exhaustiveness. Search dynamic `.from(variable)`/query-builder references, service-worker code, and any future modules before finalizing the production migration.

## 5. Release boundary

This inventory does not authorize a production migration. The canonical source gaps remain tracked by DAG-017, and the replay manifest remains blocked with cloud and production execution disabled.
