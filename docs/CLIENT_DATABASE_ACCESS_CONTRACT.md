# Client database access contract

**Status: STATIC CLIENT-SOURCE INVENTORY — NOT A GRANT OR RLS APPROVAL.**  
Reviewed branch: `engineering/stability-css-extraction-20261109`  
Review date: 2026-11-12  
Source snapshot:
- `index.html` blob: `9eaf7da65de97e48cf0e89508214c549fcf05d40`
- `membership.js` blob: `8744ffd532fe24508cc1c42ceb5b79fe4fb39343`

This document records direct browser call sites and RPC names to support a least-privilege review. It does not replace PostgreSQL catalog inspection, policy analysis, function-body review, or runtime tests. Observed client verbs are not a direct prescription for SQL grants: SECURITY INVOKER functions, triggers, foreign keys, PostgREST upsert semantics, and Storage operations can require additional privileges.

## 1. Browser RPC contract

The browser source contains 15 distinct literal `.rpc()` names across `index.html` and `membership.js`:

| RPC | Purpose / review note |
|---|---|
| `admin_create_official_member_invites` | Membership administration; privileged function and caller eligibility must remain server-enforced |
| `admin_list_memberships` | Membership administration read |
| `admin_revoke_member_invite` | Membership administration write |
| `admin_set_member_official_number` | Membership administration write |
| `admin_update_membership_status` | Membership administration write |
| `create_channel_invite` | Channel invitation creation |
| `create_private_channel` | Private channel creation |
| `edit_message_secure` | Secure message edit path; function-level write to message/history must be included in privilege review |
| `ensure_self_chat` | Self-conversation provisioning |
| `get_my_membership_state` | Current user's membership state |
| `get_or_create_direct_conversation` | Direct conversation creation/reuse; recovered implementation requires the eligibility migration candidate |
| `get_team_dashboard_stats` | Team dashboard data |
| `join_channel_by_invite` | Channel invitation redemption |
| `patch_my_user_settings` | User settings write through RPC |
| `transfer_group_ownership` | Group ownership transfer |

A regression test in `tests/staging/local-supabase/rls-least-privilege.test.mjs` extracts every literal browser RPC call and compares the names to the authenticated EXECUTE allowlist in `rls-least-privilege.assert.sql`. Dynamic RPC names intentionally fail the test until manually reviewed.

The production catalog review recorded 20 functions executable by `authenticated`, compared with these 15 client RPC names. The five additional entries previously identified for review are:
- `create_channel`
- `discover_public_channels`
- `join_public_channel`
- `admin_create_member_invites(text[])`
- `guard_chat_message_content_update()` (Trigger-only)

Do not revoke these five solely from this static list. Confirm legacy-client compatibility and trigger behavior, then test the exact production ACL delta in disposable PostgreSQL.

## 2. Direct browser table operations

The following verbs were observed at direct `supabaseClient.from(...)` call sites. The inventory is source-based and must be reconciled with all RPC and trigger side effects before changing grants.

| Table | Observed browser operations |
|---|---|
| `chat_list_items` | SELECT, UPSERT, DELETE |
| `chat_lists` | SELECT, INSERT, UPDATE, DELETE |
| `chat_messages` | SELECT, INSERT, UPDATE |
| `conversation_documents` | SELECT, INSERT, UPDATE, DELETE |
| `conversation_group_settings` | SELECT, UPSERT |
| `conversation_member_events` | SELECT |
| `conversation_members` | SELECT, INSERT, UPDATE, DELETE |
| `conversations` | SELECT, INSERT, UPDATE |
| `message_edit_history` | SELECT directly; INSERT is performed by the `edit_message_secure` SECURITY INVOKER path and must be included in the runtime grant contract |
| `message_pins` | SELECT, INSERT, DELETE |
| `message_reactions` | SELECT, UPSERT, DELETE |
| `private_conversation_notes` | SELECT, INSERT, UPDATE, DELETE |
| `private_reply_contexts` | SELECT, INSERT |
| `profiles` | SELECT, INSERT, UPDATE |
| `user_chat_preferences` | SELECT, UPSERT |
| `user_classification_rules` | SELECT, INSERT |
| `user_conversation_classifications` | SELECT, UPSERT, DELETE |
| `user_conversation_label_items` | SELECT, UPSERT, DELETE |
| `user_conversation_labels` | SELECT, INSERT |
| `user_conversation_settings` | SELECT, UPSERT |
| `user_message_stars` | SELECT, UPSERT, DELETE (query builder is stored in a variable before mutation) |
| `user_notifications` | SELECT, UPDATE |
| `user_settings` | SELECT directly; settings writes use `patch_my_user_settings` RPC |

Storage buckets observed in browser code are `avatars`, `chat-media`, and `conversation-documents`. Storage grants and `storage.objects` policies are a separate contract and are not represented by the table above.

## 3. Constraints before a grant change

1. A browser operation does not prove that a role needs unrestricted table-wide access. The matching RLS policy must constrain rows and columns must not permit ownership reassignment.
2. UPDATE and UPSERT must be tested with the actual PostgREST conflict targets. Do not infer that a table can lose UPDATE simply because the happy-path operation is named UPSERT.
3. `message_edit_history` has an indirect write path through `edit_message_secure`; its INSERT privilege and policy must be tested together.
4. `user_settings` is updated through RPC, not direct table UPDATE in the current browser source.
5. `conversation_members`, `conversations`, and `chat_messages` have both direct and RPC-mediated behavior; test group creation, membership management, direct-chat creation, message send/edit/delete, and receipts separately.
6. `conversation_member_events` is read-only at direct browser call sites; confirm no supported admin workflow writes to it directly before revoking DML.
7. Every table remains subject to active-membership and feature-specific RLS. A role-level GRANT alone is never an authorization rule.

## 4. Required verification matrix

Before an existing-object GRANT migration can be considered:

- Enumerate all 24 production `public` tables and every sequence.
- Map each table/sequence to browser call sites, RPC bodies, triggers, defaults, and foreign-key behavior.
- Record current ACL, proposed ACL, and the reason for every retained privilege.
- Verify `PUBLIC`, `anon`, and `authenticated` separately; inspect ownership and default ACLs.
- Run positive and negative tests with two eligible users, one inactive user, one non-member, and an anonymous session.
- Exercise all UI features that use each privilege, including conflict upserts and error/retry paths.
- Verify Trigger-only functions cannot be called as RPCs while their triggers still execute.
- Re-run the complete disposable-local Supabase runtime after every ACL candidate change.

## 5. Current decision

**No production GRANT, REVOKE, RLS, Storage, or RPC change is authorized by this inventory.** The direct-conversation eligibility and chat-media path-owner guards remain test-only candidates. The complete existing-table privilege allowlist is not yet proven.