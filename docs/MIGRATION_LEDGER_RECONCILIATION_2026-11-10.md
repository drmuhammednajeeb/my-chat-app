# Remote Migration Ledger Reconciliation — 2026-11-10

**Repository:** `drmuhammednajeeb/my-chat-app`  
**Reviewed main SHA:** `92d6cc8203ea2d587e9b456d7aca7724be974d5e`  
**Supabase project:** `my-chat-app` (read-only inspection)  
**Scope:** metadata/source reconciliation only. No production DDL, grants, policies, data changes, or migration execution.

## Executive result

The live Supabase migration ledger returns **59 records**, not 60. The current repository contains **54 SQL files** across `supabase/migrations` (10) and `database/changes` (44). The reviewed source DAG excludes 3 identical duplicate copies, leaving **51 unique mapped SQL sources**.

The mapping is not one-to-one: some historical SQL files contain multiple logical operations represented by separate remote migration records. Filename matches and bundled source candidates are not proof that the current file is the byte-identical original migration body.

## Coverage

- Remote ledger records: **59**
- Repository SQL files: **54**
- Unique source files after excluding 3 identical duplicates: **51**
- Test-only SQL fixtures in the reviewed manifest: **19**
- Mapped sources replaced by test-only copies: **4**
- SQL files executed in the disposable local replay: **66** (47 mapped sources + 19 fixtures)
- Records with no original SQL source in the current repository: **3**
- Records whose current definitions are recovered only from the live catalog, not from original migration files: **2**

## Source gaps that remain unresolved

- `20261107032150 tighten_direct_chat_preference_scope`: Base user_specific_direct_chat_preferences.sql exists, but does not include the later active-membership guard reflected by the live policy. The separate tightening migration source is absent.
- `20261107160647 channel_visibility_avatar_group_background`: No matching SQL source exists in the current repository tree; recover catalog definitions and search Git history before reconstruction.
- `20261107160733 harden_channel_rpc_wrappers`: No matching SQL source exists in the current repository tree; recover current RPC definitions and ACLs read-only before reconstruction.

## Catalog-only recovery

- `20261106102326 atomic_direct_conversation_creation`: `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` stores the current function definitions and inspected ACLs recovered read-only from the live catalog. It is a test-only recovery artifact, not the original migration source.
- `20261106102443 hide_atomic_direct_rpc_implementation`: `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` stores the current function definitions and inspected ACLs recovered read-only from the live catalog. It is a test-only recovery artifact, not the original migration source.

## Full remote ledger mapping

| Remote version | Remote name | Candidate source | Classification | Git blob SHA | Evidence / limitation |
|---|---|---|---|---|---|
| 20261106061954 | `ultra_chat_pro_v2` | `supabase/migrations/202611060001_ultra_chat_pro_v2.sql` | SOURCE_PRESENT | 61c671c68a5d65ce3acc06764dd3f991e2520cfa | Unique source filename match after stripping the local timestamp prefix. |
| 20261106062058 | `tighten_api_grants` | `supabase/migrations/202611060002_tighten_api_grants.sql` | SOURCE_PRESENT | 89bb6cd6defc3210af18cd8815a727285214317f | Unique source filename match after stripping the local timestamp prefix. |
| 20261106062111 | `minimum_table_privileges` | `supabase/migrations/202611060003_minimum_table_privileges.sql` | SOURCE_PRESENT | e990252f9b0740e6b4f0b94e4013d31b3bb3ce47 | Unique source filename match after stripping the local timestamp prefix. |
| 20261106062133 | `reference_profiles` | `supabase/migrations/202611060004_reference_profiles.sql` | SOURCE_PRESENT | 90ab731bf0e027e34091c3bd62307e5e7f2d42c8 | Unique source filename match after stripping the local timestamp prefix. |
| 20261106062150 | `fix_creator_membership_rls` | `supabase/migrations/202611060005_fix_creator_membership_rls.sql` | SOURCE_PRESENT | 414a1ae97e3ba57870c9e79f80c74fe44b845b01 | Unique source filename match after stripping the local timestamp prefix. |
| 20261106062207 | `explicit_legacy_deny` | `supabase/migrations/202611060006_explicit_legacy_deny.sql` | SOURCE_PRESENT | dc1e9e33841c2aa42c444dcf1222b215f689320c | Unique source filename match after stripping the local timestamp prefix. |
| 20261106102326 | `atomic_direct_conversation_creation` | `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` | CATALOG_RECOVERED_NOT_ORIGINAL_MIGRATION | 6348fab2c501abae17e8b991396ad48e588d8e58 | Current function definitions and inspected ACLs were recovered from the live catalog; not the original migration body. |
| 20261106102443 | `hide_atomic_direct_rpc_implementation` | `tests/staging/local-supabase/fixtures/direct-conversation-rpc.sql` | CATALOG_RECOVERED_NOT_ORIGINAL_MIGRATION | 6348fab2c501abae17e8b991396ad48e588d8e58 | Current function definitions and inspected ACLs were recovered from the live catalog; not the original migration body. |
| 20261106125643 | `message_reactions_and_realtime` | `database/changes/message_reactions_and_whatsapp_typography.sql` | SOURCE_BUNDLED | 3abf3d58bd1d06bdd4a062dc3400c40484c28a5d | Source creates reaction table, user index, RLS policies and Realtime publication. |
| 20261106125901 | `index_message_reaction_user_fk` | `database/changes/message_reactions_and_whatsapp_typography.sql` | SOURCE_BUNDLED | 3abf3d58bd1d06bdd4a062dc3400c40484c28a5d | Source includes the message_reactions user_id index; verify live index definition and historical migration boundary. |
| 20261106130351 | `professional_message_controls_and_receipts` | `database/changes/professional_message_controls_and_receipts.sql` | SOURCE_PRESENT | de4d9e3f5ff48a10ed5a1e2a6ece0b7389b5b3ab | Unique source filename match after stripping the local timestamp prefix. |
| 20261106130540 | `realtime_conversation_member_receipts` | `database/changes/professional_message_controls_and_receipts.sql` | SOURCE_BUNDLED | de4d9e3f5ff48a10ed5a1e2a6ece0b7389b5b3ab | Source updates conversation_members and adds it to Realtime publication. |
| 20261106130804 | `index_message_pins_pinned_by` | `database/changes/professional_message_controls_and_receipts.sql` | SOURCE_BUNDLED | de4d9e3f5ff48a10ed5a1e2a6ece0b7389b5b3ab | Source contains message_pins_pinned_by_idx. |
| 20261106132655 | `private_channels_with_secure_invites` | `database/changes/private_channels_with_secure_invites.sql` | SOURCE_PRESENT | de7be9ca152256fd10c16bd2343625fc91587a9f | Unique source filename match after stripping the local timestamp prefix. |
| 20261106132740 | `deny_direct_channel_invite_table_access` | `database/changes/private_channels_with_secure_invites.sql` | SOURCE_BUNDLED | de7be9ca152256fd10c16bd2343625fc91587a9f | Source defines the no-direct-access policy for channel invites. |
| 20261106132753 | `index_channel_invites_created_by` | `database/changes/private_channels_with_secure_invites.sql` | SOURCE_BUNDLED | de7be9ca152256fd10c16bd2343625fc91587a9f | Source contains channel_invites_created_by_idx. |
| 20261106135225 | `harden_chat_table_privileges_and_membership_updates` | `supabase/migrations/202611060007_harden_chat_table_privileges.sql` | SOURCE_BUNDLED | e164e04680c5c0a768bfbd39f4387e0d038a9749 | Remote name is broader than filename; SQL includes chat grants and membership update guard. |
| 20261107014128 | `unified_user_notifications` | `supabase/migrations/20261107014128_unified_user_notifications.sql` | SOURCE_PRESENT | 140e14ef8fb7a9b4dd94d7279285fe0b1396b89e | Unique source filename match after stripping the local timestamp prefix. |
| 20261107014350 | `index_user_notification_foreign_keys` | `supabase/migrations/20261107014350_index_user_notification_foreign_keys.sql` | SOURCE_PRESENT_DUPLICATE_IDENTICAL | 304c3f9e9e1dd563df05a98269f1616bcb6a22a7 | Canonical supabase/migrations copy selected; database/changes copy excluded as identical. |
| 20261107032052 | `user_specific_direct_chat_preferences` | `database/changes/user_specific_direct_chat_preferences.sql` | SOURCE_PRESENT | c9fc4c5ff4f4752edc773c49a64f4aad64cd3a08 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107032150 | `tighten_direct_chat_preference_scope` | — | SOURCE_MISSING | — | Base user_specific_direct_chat_preferences.sql exists, but does not include the later active-membership guard reflected by the live policy. The separate tightening migration source is absent. |
| 20261107035217 | `user_avatars_storage_bucket` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source creates/upserts the avatars bucket and owner-scoped policies. |
| 20261107035243 | `realtime_profile_avatar_updates` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source adds public.profiles to supabase_realtime. |
| 20261107035443 | `avatar_storage_upsert_select_policy` | `database/changes/20261107035500_user_avatars_storage.sql` | SOURCE_BUNDLED | b4ba933234941f773aea6c6e3734eae629715ae1 | Source includes avatar read/insert/update/delete policy definitions. |
| 20261107041223 | `per_user_chat_archive_and_preferences_rls` | `database/changes/20261107050000_per_user_chat_archive_and_preferences_rls.sql` | SOURCE_PRESENT | 9530e894fc2ea1e314fbeaf10ed893291b1cf1b3 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107061012 | `self_message_conversation` | `database/changes/20261107061012_self_message_conversation.sql` | SOURCE_PRESENT | 38b59e24f1de15a351f2fe27ec65ade56e6e8175 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107061103 | `ensure_self_chat_rpc` | `database/changes/20261107061103_ensure_self_chat_rpc.sql` | SOURCE_PRESENT | 93523592aa7d080a909954bfcca17a1609bb224b | Unique source filename match after stripping the local timestamp prefix. |
| 20261107115802 | `account_settings_reactions_message_edit_v2` | `database/changes/20261107123000_account_settings_reactions_message_edit_v2.sql` | SOURCE_PRESENT | 961b5b6c7d31bd9cc3a87aa037aa2a9891cba051 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107120149 | `harden_message_edit_permissions` | `database/changes/20261107124500_harden_message_edit_permissions.sql` | SOURCE_PRESENT | 845a1e9074a3a55ab3faa5bb48d8d0ec47f8e880 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107120239 | `restore_message_edit_guard` | `database/changes/20261107130000_restore_message_edit_guard.sql` | SOURCE_PRESENT | 73564e1dcd4dbb65c2b23e890ad070ade9b9482d | Unique source filename match after stripping the local timestamp prefix. |
| 20261107120426 | `index_message_edit_history` | `database/changes/20261107131500_index_message_edit_history.sql` | SOURCE_PRESENT | ccc72a34680d0e2da3919b8760591981bc0cebb0 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107125149 | `group_management_custom_lists_20261107` | `database/changes/20261107125149_group_management_custom_lists_20261107.sql` | SOURCE_PRESENT | 8765dfb8905dfd6c60694fa2be2e472f3f14260b | Unique source filename match after stripping the local timestamp prefix. |
| 20261107125546 | `enforce_group_message_expiry_and_realtime` | `database/changes/20261107125546_enforce_group_message_expiry_and_realtime.sql` | SOURCE_PRESENT | a808b77f71b4124993800a841495433f895026a3 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107125616 | `secure_group_ownership_transfer` | `database/changes/20261107125616_secure_group_ownership_transfer.sql` | SOURCE_PRESENT | 9fd8e829d33b13aed489d402135c33ce5138e739 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107125754 | `sync_personal_chat_lists_and_preferences` | `database/changes/20261107125754_sync_personal_chat_lists_and_preferences.sql` | SOURCE_PRESENT | aa834b85b4d12eb418629578135bc9cdb64c5bb6 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107125934 | `tighten_group_settings_security_and_indexes` | `database/changes/20261107125934_tighten_group_settings_security_and_indexes.sql` | SOURCE_PRESENT | bd56800c78256c5ac8b329d2ee7642e435e43ff5 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107130140 | `personal_favorites_in_conversation_settings` | `database/changes/20261107130140_personal_favorites_in_conversation_settings.sql` | SOURCE_PRESENT | a89ece0b23230bb19e9a603163349cdf8e7e53a7 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107130534 | `include_team_admins_in_group_management` | `database/changes/20261107130534_include_team_admins_in_group_management.sql` | SOURCE_PRESENT | d339d8791bfaf0aa4ac63d2f183e81bd54fc56c9 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107130737 | `remove_duplicate_chat_favorite_column` | `database/changes/20261107130737_remove_duplicate_chat_favorite_column.sql` | SOURCE_PRESENT | 6a165eb9bf85d2091ba4a64f35129baec8557d29 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107130851 | `schedule_expired_group_message_purge` | `database/changes/20261107130851_schedule_expired_group_message_purge.sql` | SOURCE_PRESENT | 4c154dcd14e70e0561880d6bce3d0d63b554d16b | Unique source filename match after stripping the local timestamp prefix. |
| 20261107130954 | `scope_team_admin_overrides_to_group_features` | `database/changes/20261107130954_scope_team_admin_overrides_to_group_features.sql` | SOURCE_PRESENT | d547452a45275cb6eefb6b4b8c6585769061951e | Unique source filename match after stripping the local timestamp prefix. |
| 20261107134334 | `conversation_workspaces_private_documents` | `database/changes/20261107134500_conversation_workspaces_private_documents.sql` | SOURCE_PRESENT | b1211716490c9d758064c8266107d6fd7b356646 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107134414 | `index_workspace_and_document_foreign_keys` | `database/changes/20261107134600_index_workspace_foreign_keys.sql` | SOURCE_BUNDLED | a12f0f8159d2a05f3847ac18e89ca40317db560e | Timestamp differs; source contains workspace/document foreign-key indexes. |
| 20261107135149 | `workspace_realtime_and_note_assignment` | `database/changes/20261107135200_workspace_realtime_and_note_assignment.sql` | SOURCE_PRESENT | b25c60e57c28c744c95d53d15c47820fd917591a | Unique source filename match after stripping the local timestamp prefix. |
| 20261107135501 | `harden_workspace_storage_and_private_reply_scope` | `database/changes/20261107135500_harden_workspace_storage_and_private_reply_scope.sql` | SOURCE_PRESENT | 70515432f0570cd9d9caeaca37f9cd431b316b6f | Unique source filename match after stripping the local timestamp prefix. |
| 20261107144109 | `private_membership_system_20261107` | `database/changes/20261107144109_private_membership_system_20261107.sql` | SOURCE_PRESENT | 175d72492486f99b05f7bb5f42638a8c8904dc4a | Unique source filename match after stripping the local timestamp prefix. |
| 20261107144227 | `secure_membership_admin_rpc_wrappers` | `database/changes/20261107144227_secure_membership_admin_rpc_wrappers.sql` | SOURCE_PRESENT | 38ee84d896b89510bbf4c6561d14df217029cb71 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107144626 | `membership_state_self_check_and_deny_policy` | `database/changes/20261107144626_membership_state_self_check_and_deny_policy.sql` | SOURCE_PRESENT | 3738d3d4cdb06598bef78f6e685ec9e7e2caee48 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107144758 | `membership_invitation_foreign_key_indexes` | `database/changes/20261107144758_membership_invitation_foreign_key_indexes.sql` | SOURCE_PRESENT | 536966ce810bf9c7e8916e03982c11a79f86791f | Unique source filename match after stripping the local timestamp prefix. |
| 20261107145232 | `membership_invitation_acceptance_after_auth_insert_fix` | `database/changes/20261107145232_membership_invitation_acceptance_after_auth_insert_fix.sql` | SOURCE_PRESENT | cd6c0332400e2b80ba4961bc6183813d4b0f37a2 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107152550 | `official_forever_membership_numbers_manual_verification` | `database/changes/20261107152550_official_forever_membership_numbers_manual_verification.sql` | SOURCE_PRESENT | 775015b47dbd7cbe4310fee9deacb322c2cc8b9f | Unique source filename match after stripping the local timestamp prefix. |
| 20261107152733 | `fix_official_membership_invite_duplicate_validation` | `database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql` | SOURCE_PRESENT | 8d8302fa9f80c89e3247c8bcea03e725a265d380 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107153051 | `remove_legacy_sequential_membership_generator` | `database/changes/20261107153051_remove_legacy_sequential_membership_generator.sql` | SOURCE_PRESENT | 8273fdebc852c5f95adb48990f4bb06ba78bd97a | Unique source filename match after stripping the local timestamp prefix. |
| 20261107153110 | `anchor_initial_official_membership_verification_by_number` | `database/changes/20261107153110_anchor_initial_official_membership_verification_by_number.sql` | SOURCE_PRESENT | 251d430e00bd563b8f857359caa2fb5806dbe3bc | Unique source filename match after stripping the local timestamp prefix. |
| 20261107153214 | `restore_secure_membership_state_rpc_wrapper` | `database/changes/20261107153214_restore_secure_membership_state_rpc_wrapper.sql` | SOURCE_PRESENT | d71ebeca3808ae0b1ac321a48a089f6986422914 | Unique source filename match after stripping the local timestamp prefix. |
| 20261107154825 | `fix_chat_message_rls_reply_recursion` | `database/changes/20261107154900_fix_chat_message_rls_reply_recursion.sql` | SOURCE_BUNDLED | aa73588f3bfce50b9874ef68511c52fe60f8d52b | Filename timestamp differs from the remote ledger version. |
| 20261107160647 | `channel_visibility_avatar_group_background` | — | SOURCE_MISSING | — | No matching SQL source exists in the current repository tree; recover catalog definitions and search Git history before reconstruction. |
| 20261107160733 | `harden_channel_rpc_wrappers` | — | SOURCE_MISSING | — | No matching SQL source exists in the current repository tree; recover current RPC definitions and ACLs read-only before reconstruction. |
| 20261108075913 | `unify_forever_membership_number_format` | `supabase/migrations/20261108075913_unify_forever_membership_number_format.sql` | SOURCE_PRESENT | 3a69a03e9ae03374453c0d39d05b7a46c9fcafd5 | Unique source filename match after stripping the local timestamp prefix. |

## Identical duplicate copies excluded from replay

- `database/changes/chat_table_privilege_hardening.sql` — canonical selected source: `supabase/migrations/202611060007_harden_chat_table_privileges.sql`.
- `database/changes/unified_notifications.sql` — canonical selected source: `supabase/migrations/20261107014128_unified_user_notifications.sql`.
- `database/changes/index_user_notification_foreign_keys.sql` — canonical selected source: `supabase/migrations/20261107014350_index_user_notification_foreign_keys.sql`.

## Historical-source cautions

1. `202611060006_explicit_legacy_deny` references `public.messages`. The live catalog confirms that the legacy table exists and its observed row count was zero. Do not drop it based only on the earlier assumption that it does not exist.
2. Historical membership SQL contains a fixed membership-number value. Local replay intentionally uses synthetic fixture copies; do not replay those seed files unchanged into a clean test database.
3. `20261107152733_fix_official_membership_invite_duplicate_validation.sql` lacks a statement terminator in the canonical historical source. A test-only copy adds the terminator; the canonical file remains unchanged.
4. The two direct-conversation RPC records have no original SQL files in the repository. A test-only fixture preserves current definitions extracted read-only from the live catalog with provenance; it does not reconstruct the original historical migration body.
5. The existing replay manifest remains `DESIGN_ONLY` / `BLOCKED` and denies cloud/production execution. CI success proves only the isolated local replay defined by the guarded runner.

## Next actions

1. Recover missing original sources from Git history, release artifacts, or verified deployment records. If unavailable, mark them explicitly as `CATALOG_RECOVERED` or `UNRECOVERED`; do not invent historical SQL.
2. Compare live catalog definitions for every unmatched record: tables, indexes, constraints, policies, functions, triggers, publication membership, extensions, and scheduled jobs.
3. Establish one canonical migration directory and immutable checksums for all new migrations. Do not rewrite the remote ledger or rename already-applied versions.
4. Replay the canonical stream from an empty disposable Supabase stack and compare catalog snapshots with the approved live snapshot.
5. Keep production read-only until the complete source map, backup/restore rehearsal, and security compatibility tests pass.

## Verification boundary

This report reconciles remote migration metadata with the current repository and reviewed dependency plan. It does not prove that every historical SQL body is recovered, that all 59 records have a one-to-one file, or that a fresh database built from the current files is production-equivalent.
