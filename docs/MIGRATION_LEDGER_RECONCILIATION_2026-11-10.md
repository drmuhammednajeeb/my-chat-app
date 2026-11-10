# Remote Migration Ledger Reconciliation — 2026-11-10

**Repository:** `drmuhammednajeeb/my-chat-app`  
**Branch reviewed:** `main` at `92d6cc8203ea2d587e9b456d7aca7724be974d5e`  
**Supabase project:** `my-chat-app` (read-only inspection)  
**Scope:** metadata/source reconciliation only. No migration, production DDL, grant, policy, or data mutation was executed.

## Executive result

The live Supabase migration ledger returns **59 records**, not 60. The current repository contains **54 SQL files** across `supabase/migrations` (10) and `database/changes` (44). The reviewed source DAG records 3 identical duplicate copies excluded, leaving **51 unique mapped SQL sources**. The existing local replay executes 47 mapped sources plus 19 test-only fixtures (66 SQL files total); four mapped sources are replaced by test-only copies.

This is a many-to-many reconciliation: some historical SQL files bundle multiple remote migration operations. A matching filename is evidence of a candidate source, not proof that the file is byte-for-byte the original migration body.

## Reconciliation status

- Remote ledger records: **59**
- Repository SQL files: **54**
- Unique source files after duplicate exclusions: **51**
- Test-only SQL fixtures in the reviewed manifest: **19**
- Mapped source files replaced by test-only fixtures: **4**
- SQL files executed in the disposable local replay: **66**
- Original migration sources not present in the repository: **45**
- Catalog-recovered definitions that are not original migration files: **2**

### Source gaps that must remain blocked

- `20261106061954 ultra_chat_pro_v2`: No unique source filename match; manual content/provenance review required.
- `20261106062058 tighten_api_grants`: No unique source filename match; manual content/provenance review required.
- `20261106062111 minimum_table_privileges`: No unique source filename match; manual content/provenance review required.
- `20261106062133 reference_profiles`: No unique source filename match; manual content/provenance review required.
- `20261106062150 fix_creator_membership_rls`: No unique source filename match; manual content/provenance review required.
- `20261106062207 explicit_legacy_deny`: No unique source filename match; manual content/provenance review required.
- `20261106130351 professional_message_controls_and_receipts`: No unique source filename match; manual content/provenance review required.
- `20261106132655 private_channels_with_secure_invites`: No unique source filename match; manual content/provenance review required.
- `20261107014128 unified_user_notifications`: No unique source filename match; manual content/provenance review required.
- `20261107014350 index_user_notification_foreign_keys`: No unique source filename match; manual content/provenance review required.
- `20261107032052 user_specific_direct_chat_preferences`: No unique source filename match; manual content/provenance review required.
- `20261107032150 tighten_direct_chat_preference_scope`: Base source user_specific_direct_chat_preferences.sql exists, but it does not contain the later active-membership guard reflected in the live policy. The separate tightening migration source is absent.
- `20261107041223 per_user_chat_archive_and_preferences_rls`: No unique source filename match; manual content/provenance review required.
- `20261107061012 self_message_conversation`: No unique source filename match; manual content/provenance review required.
- `20261107061103 ensure_self_chat_rpc`: No unique source filename match; manual content/provenance review required.
- `20261107115802 account_settings_reactions_message_edit_v2`: No unique source filename match; manual content/provenance review required.
- `20261107120149 harden_message_edit_permissions`: No unique source filename match; manual content/provenance review required.
- `20261107120239 restore_message_edit_guard`: No unique source filename match; manual content/provenance review required.
- `20261107120426 index_message_edit_history`: No unique source filename match; manual content/provenance review required.
- `20261107125149 group_management_custom_lists_20261107`: No unique source filename match; manual content/provenance review required.
- `20261107125546 enforce_group_message_expiry_and_realtime`: No unique source filename match; manual content/provenance review required.
- `20261107125616 secure_group_ownership_transfer`: No unique source filename match; manual content/provenance review required.
- `20261107125754 sync_personal_chat_lists_and_preferences`: No unique source filename match; manual content/provenance review required.
- `20261107125934 tighten_group_settings_security_and_indexes`: No unique source filename match; manual content/provenance review required.
- `20261107130140 personal_favorites_in_conversation_settings`: No unique source filename match; manual content/provenance review required.
- `20261107130534 include_team_admins_in_group_management`: No unique source filename match; manual content/provenance review required.
- `20261107130737 remove_duplicate_chat_favorite_column`: No unique source filename match; manual content/provenance review required.
- `20261107130851 schedule_expired_group_message_purge`: No unique source filename match; manual content/provenance review required.
- `20261107130954 scope_team_admin_overrides_to_group_features`: No unique source filename match; manual content/provenance review required.
- `20261107134334 conversation_workspaces_private_documents`: No unique source filename match; manual content/provenance review required.
- `20261107135149 workspace_realtime_and_note_assignment`: No unique source filename match; manual content/provenance review required.
- `20261107135501 harden_workspace_storage_and_private_reply_scope`: No unique source filename match; manual content/provenance review required.
- `20261107144109 private_membership_system_20261107`: No unique source filename match; manual content/provenance review required.
- `20261107144227 secure_membership_admin_rpc_wrappers`: No unique source filename match; manual content/provenance review required.
- `20261107144626 membership_state_self_check_and_deny_policy`: No unique source filename match; manual content/provenance review required.
- `20261107144758 membership_invitation_foreign_key_indexes`: No unique source filename match; manual content/provenance review required.
- `20261107145232 membership_invitation_acceptance_after_auth_insert_fix`: No unique source filename match; manual content/provenance review required.
- `20261107152550 official_forever_membership_numbers_manual_verification`: No unique source filename match; manual content/provenance review required.
- `20261107152733 fix_official_membership_invite_duplicate_validation`: No unique source filename match; manual content/provenance review required.
- `20261107153051 remove_legacy_sequential_membership_generator`: No unique source filename match; manual content/provenance review required.
- `20261107153110 anchor_initial_official_membership_verification_by_number`: No unique source filename match; manual content/provenance review required.
- `20261107153214 restore_secure_membership_state_rpc_wrapper`: No unique source filename match; manual content/provenance review required.
- `20261107160647 channel_visibility_avatar_group_background`: No matching SQL source in current repository tree; recover current catalog definitions and search Git history before reconstruction.
- `20261107160733 harden_channel_rpc_wrappers`: No matching SQL source in current repository tree; recover current RPC definitions and ACLs read-only before reconstruction.
- `20261108075913 unify_forever_membership_number_format`: No unique source filename match; manual content/provenance review required.

### Catalog-only recovery

- `20261106102326 atomic_direct_conversation_creation`: current function definitions/ACLs are preserved in `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql`, but this is a test-only recovery of current catalog state, **not** the original historical migration. Original source provenance remains unresolved.
- `20261106102443 hide_atomic_direct_rpc_implementation`: current function definitions/ACLs are preserved in `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql`, but this is a test-only recovery of current catalog state, **not** the original historical migration. Original source provenance remains unresolved.

## Full remote ledger mapping

| Remote version | Remote name | Candidate source | Classification | Git blob SHA | Evidence / limitation |
|---|---|---|---|---|---|
| 20261106061954 | `ultra_chat_pro_v2` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106062058 | `tighten_api_grants` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106062111 | `minimum_table_privileges` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106062133 | `reference_profiles` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106062150 | `fix_creator_membership_rls` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106062207 | `explicit_legacy_deny` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106102326 | `atomic_direct_conversation_creation` | `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` | CATALOG_RECOVERED_NOT_ORIGINAL_MIGRATION | 6348fab2c501abae17e8b991396ad48e588d8e58 | Recovered current function definitions and inspected ACLs from live catalog; not the original migration body. |
| 20261106102443 | `hide_atomic_direct_rpc_implementation` | `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` | CATALOG_RECOVERED_NOT_ORIGINAL_MIGRATION | 6348fab2c501abae17e8b991396ad48e588d8e58 | Recovered current function definitions and inspected ACLs from live catalog; not the original migration body. |
| 20261106125643 | `message_reactions_and_realtime` | `database/changes/message_reactions_and_whatsapp_typography.sql` | SOURCE_BUNDLED | 3abf3d58bd1d06bdd4a062dc3400c40484c28a5d | Source creates reaction table, user index, RLS policies and Realtime publication. |
| 20261106125901 | `index_message_reaction_user_fk` | `database/changes/message_reactions_and_whatsapp_typography.sql` | SOURCE_BUNDLED | 3abf3d58bd1d06bdd4a062dc3400c40484c28a5d | Candidate is the user_id index in the same source; verify live index definition and exact migration boundary. |
| 20261106130351 | `professional_message_controls_and_receipts` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106130540 | `realtime_conversation_member_receipts` | `database/changes/professional_message_controls_and_receipts.sql` | SOURCE_BUNDLED | de4d9e3f5ff48a10ed5a1e2a6ece0b7389b5b3ab | Source alters conversation_members and adds it to Realtime publication. |
| 20261106130804 | `index_message_pins_pinned_by` | `database/changes/professional_message_controls_and_receipts.sql` | SOURCE_BUNDLED | de4d9e3f5ff48a10ed5a1e2a6ece0b7389b5b3ab | Source contains message_pins_pinned_by_idx. |
| 20261106132655 | `private_channels_with_secure_invites` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261106132740 | `deny_direct_channel_invite_table_access` | `database/changes/private_channels_with_secure_invites.sql` | SOURCE_BUNDLED | de7be9ca152256fd10c16bd2343625fc91587a9f | Source defines private channel invite table denial policy. |
| 20261106132753 | `index_channel_invites_created_by` | `database/changes/private_channels_with_secure_invites.sql` | SOURCE_BUNDLED | de7be9ca152256fd10c16bd2343625fc91587a9f | Source contains channel_invites_created_by_idx. |
| 20261106135225 | `harden_chat_table_privileges_and_membership_updates` | `supabase/migrations/202611060007_harden_chat_table_privileges.sql` | SOURCE_BUNDLED | e164e04680c5c0a768bfbd39f4387e0d038a9749 | Filename differs from remote ledger name; SQL covers chat table grants and membership update guard. |
| 20261107014128 | `unified_user_notifications` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107014350 | `index_user_notification_foreign_keys` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107032052 | `user_specific_direct_chat_preferences` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107032150 | `tighten_direct_chat_preference_scope` | — | SOURCE_MISSING | — | Base source user_specific_direct_chat_preferences.sql exists, but it does not contain the later active-membership guard reflected in the live policy. The separate tightening migration source is absent. |
| 20261107035217 | `user_avatars_storage_bucket` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source creates/upserts avatars bucket and owner-scoped policies. |
| 20261107035243 | `realtime_profile_avatar_updates` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source adds public.profiles to supabase_realtime. |
| 20261107035443 | `avatar_storage_upsert_select_policy` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source contains avatar select/insert/update/delete policy definitions. |
| 20261107041223 | `per_user_chat_archive_and_preferences_rls` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107061012 | `self_message_conversation` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107061103 | `ensure_self_chat_rpc` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107115802 | `account_settings_reactions_message_edit_v2` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107120149 | `harden_message_edit_permissions` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107120239 | `restore_message_edit_guard` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107120426 | `index_message_edit_history` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107125149 | `group_management_custom_lists_20261107` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107125546 | `enforce_group_message_expiry_and_realtime` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107125616 | `secure_group_ownership_transfer` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107125754 | `sync_personal_chat_lists_and_preferences` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107125934 | `tighten_group_settings_security_and_indexes` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107130140 | `personal_favorites_in_conversation_settings` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107130534 | `include_team_admins_in_group_management` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107130737 | `remove_duplicate_chat_favorite_column` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107130851 | `schedule_expired_group_message_purge` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107130954 | `scope_team_admin_overrides_to_group_features` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107134334 | `conversation_workspaces_private_documents` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107134414 | `index_workspace_and_document_foreign_keys` | `database/changes/20261107134600_index_workspace_foreign_keys.sql` | SOURCE_BUNDLED | a12f0f8159d2a05f3847ac18e89ca40317db560e | Timestamp and name differ; source contains workspace/document FK indexes. |
| 20261107135149 | `workspace_realtime_and_note_assignment` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107135501 | `harden_workspace_storage_and_private_reply_scope` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107144109 | `private_membership_system_20261107` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107144227 | `secure_membership_admin_rpc_wrappers` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107144626 | `membership_state_self_check_and_deny_policy` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107144758 | `membership_invitation_foreign_key_indexes` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107145232 | `membership_invitation_acceptance_after_auth_insert_fix` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107152550 | `official_forever_membership_numbers_manual_verification` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107152733 | `fix_official_membership_invite_duplicate_validation` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107153051 | `remove_legacy_sequential_membership_generator` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107153110 | `anchor_initial_official_membership_verification_by_number` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107153214 | `restore_secure_membership_state_rpc_wrapper` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |
| 20261107154825 | `fix_chat_message_rls_reply_recursion` | `database/changes/20261107154900_fix_chat_message_rls_reply_recursion.sql` | SOURCE_BUNDLED | aa73588f3bfce50b9874ef68511c52fe60f8d52b | Filename timestamp differs by 35 seconds from remote ledger version. |
| 20261107160647 | `channel_visibility_avatar_group_background` | — | SOURCE_MISSING | — | No matching SQL source in current repository tree; recover current catalog definitions and search Git history before reconstruction. |
| 20261107160733 | `harden_channel_rpc_wrappers` | — | SOURCE_MISSING | — | No matching SQL source in current repository tree; recover current RPC definitions and ACLs read-only before reconstruction. |
| 20261108075913 | `unify_forever_membership_number_format` | — | SOURCE_MISSING | — | No unique source filename match; manual content/provenance review required. |

## Duplicate source copies

The reviewed dependency DAG excludes these byte-identical copies from replay:

- `database/changes/chat_table_privilege_hardening.sql` — canonical selected source: `supabase/migrations/202611060007_harden_chat_table_privileges.sql`.
- `database/changes/unified_notifications.sql` — canonical selected source: `supabase/migrations/20261107014128_unified_user_notifications.sql`.
- `database/changes/index_user_notification_foreign_keys.sql` — canonical selected source: `supabase/migrations/20261107014350_index_user_notification_foreign_keys.sql`.

## Important historical-source cautions

1. The migration `202611060006_explicit_legacy_deny` references `public.messages`. The live catalog confirms a legacy `public.messages` table exists and its observed row count was zero. It must not be dropped or replaced based on the earlier assumption that it does not exist.
2. The official membership-number history contains fixed test/production-specific values. The local replay deliberately substitutes synthetic fixture copies. Never replay those historical seed files into a clean test database unchanged.
3. `20261107152733_fix_official_membership_invite_duplicate_validation.sql` has a missing statement terminator in the canonical historical source. A test-only copy adds the terminator; the canonical file remains unchanged.
4. The two direct-conversation RPC migrations have no original SQL file in the repository. A test-only fixture contains current definitions extracted read-only from the live catalog with provenance; it does not reconstruct the original migration intent or historical body.
5. The existing replay manifest is explicitly `DESIGN_ONLY` / `BLOCKED` and does not authorize cloud or production execution. The successful CI run proves only the isolated local replay defined by the runner.

## Next actions

1. Recover missing original source from Git history, prior release artifacts, or verified deployment records; if unavailable, mark it permanently as `CATALOG_RECOVERED` or `UNRECOVERED`, never silently invent it.
2. Query and compare live object definitions for every unmatched remote migration (tables, indexes, constraints, policies, functions, triggers, publication membership, extensions and scheduled jobs).
3. Build a canonical migration stream with immutable checksums and one file per new migration going forward. Do not rewrite the remote ledger or rename already-applied migrations.
4. Replay the canonical stream from an empty disposable Supabase stack and compare resulting catalog snapshots with the approved live snapshot.
5. Keep production read-only until the complete source map, data backup/restore rehearsal, and security compatibility tests pass.

## Verification boundary

This report reconciles the remote migration metadata with current repository files and the existing reviewed dependency plan. It does **not** prove that every historical SQL body is recovered, that all 59 migration versions have a one-to-one file, or that a fresh database created from current files is production-equivalent.
