# CRM Foundation Audit — 2026-11-12

## Executive decision

**Status: DISCOVERY COMPLETE / CRM DESIGN NOT YET APPROVED**

This is a read-only baseline of the current `main` source and the connected Supabase production catalog. It is intended to prevent CRM from duplicating existing workspace capabilities or depending on an incomplete migration history.

No application code, schema, policies, data, storage objects, deployments, or existing branches were changed during the audit. The only repository write for this phase is this documentation file on the isolated branch `audit/crm-foundation-baseline-20261112`.

## 1. Audit scope and provenance

- Repository: `drmuhammednajeeb/my-chat-app`
- Default branch: `main`
- Audited source commit: `67c7e46d26037ad0cf94a44aaf3a507c6a5171b4`
- Production Supabase project reference: `lvkeohpuucuklagvwpnq`
- Audit date: 2026-11-12
- Methods: GitHub source/tree inspection; read-only PostgreSQL catalog and Supabase metadata queries; read-only advisor checks.
- No customer/message row contents were queried. Findings concern schema, object definitions, grants, policies, migration metadata, and source code.

## 2. Frontend and repository baseline

### Runtime

- Static Arabic-first SPA; `index.html` is the root application entry point.
- Current main version: `2026.11.12.6`.
- Service Worker cache version: `v31`.
- `index.html`: 2,648 lines; 286,536 characters returned by the source API. Approximately 255,747 characters are inside inline script blocks.
- The page loads Supabase JS UMD `2.49.1` from CDN and eight local JavaScript files: `membership.js` plus seven files under `modules/`.
- Current standalone modules cover message loading, reactions, voice recording, audio playback, app updates, profile status/conversation images, and backup/restore. Most application behavior remains in inline JavaScript in `index.html`.
- The Service Worker caches static shell assets and explicitly avoids caching Supabase/API responses, authenticated data, and user messages.
- No root `package.json`, Vite config, `vercel.json`, or `supabase/config.toml` exists in this audited tree. README describes the app as a static frontend without a repository build step.

### CRM source scan

- No `crm/` module, CRM-specific test directory, or CRM-specific table name exists in the audited main tree/catalog.
- No CRM-specific browser data calls or CRM RPC names were found in the current `index.html`.
- Existing workspace and team features are implemented in the main inline script rather than a separate CRM module.

### Documentation freshness

- `docs/ARCHITECTURE_DEPENDENCY_MAP.md` describes an older source snapshot, commit `7b417f81800c388dbb209086c5df895fc53abee5`, with different `index.html` size/line counts. Treat it as historical architecture guidance, not the current numerical baseline.
- `docs/DATABASE_OBJECT_INVENTORY_AND_DEPENDENCY_REVIEW.md` reports 53 SQL source files and 43 historical changes, while the current `reviewed-dependency-dag.json` records 10 CLI migrations plus 45 historical changes (55 source files). The latter matches the current source manifest/tree counts. The inventory document should be reconciled before it is used as a canonical count.

## 3. Live Supabase catalog baseline

### Object inventory

- 28 application tables across `public` and `app_private`:
  - 25 in `public`
  - 3 in `app_private`
- RLS is enabled on all 28 tables.
- 56 RLS policies were found; every application table has at least one policy.
- No table has FORCE ROW LEVEL SECURITY enabled. This is recorded as a catalog fact, not automatically treated as a defect.
- Production migration history contains 62 recorded migrations.
- Six installed extensions: `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`.
- Six Storage buckets:
  - Public: `avatars`
  - Private: `channel-avatars`, `chat-media`, `conversation-avatars`, `conversation-documents`, `profile-status-media`
- No Supabase Edge Functions were listed for this project.

### Existing table domains

Core identity and membership:
- `profiles`
- `app_private.team_admins`
- `app_private.member_invitations`

Conversation and messaging:
- `conversations`, `conversation_members`, `chat_messages`
- `message_reactions`, `message_pins`, `message_edit_history`
- `conversation_member_events`, `conversation_group_settings`
- `private_reply_contexts`, `user_notifications`

Personal workspace and organization:
- `private_conversation_notes`
- `chat_lists`, `chat_list_items`
- `user_conversation_labels`, `user_conversation_label_items`
- `user_conversation_classifications`, `user_classification_rules`
- `user_chat_preferences`, `user_conversation_settings`, `user_message_stars`, `user_settings`
- `conversation_documents`

Temporary status:
- `profile_statuses`

Legacy:
- `public.messages` exists in the production catalog, but current browser code uses `public.chat_messages`. The repository inventory states that no canonical source migration creates the legacy `messages` table; its current source use is limited to legacy deny/compatibility handling. Do not build CRM or new messaging functionality on `public.messages`.

## 4. CRM overlap matrix

| CRM capability | Existing implementation | Actual boundary |
|---|---|---|
| Conversation notes | `private_conversation_notes` | Private notes owned by a user and attached to a conversation |
| Order tracking context | `order_status`, `financial_amount`, `currency` on private notes | Order state/context, not a standalone deal/order entity |
| Follow-up date | `follow_up_at` on private notes | A timestamp attached to a note; not a task/reminder subsystem |
| Responsible person | `responsible_user_id` on private notes | Must be a member of the same conversation under the policy |
| Conversation labels | `user_conversation_labels` and `user_conversation_label_items` | Labels conversations, not customer/contact records |
| Work/personal classification | `user_conversation_classifications` and `user_classification_rules` | Classifies conversations for the current user |
| Conversation folders | `chat_lists` and `chat_list_items` | Organizes conversations, not contacts |
| Documents | `conversation_documents` | Files owned/shared in a conversation context |
| Team administration | `team_admins`, `conversation_members`, team dashboard RPC | Platform/team and conversation permissions, not CRM sales-team membership |
| User identity | `profiles` | Registered platform members; not a prospect/customer directory |

### Private conversation notes — confirmed schema

Fields include:
- `id`, `user_id`, `conversation_id`, `note`
- `order_status`, `financial_amount`, `currency`
- `follow_up_at`, `responsible_user_id`
- `created_at`, `updated_at`

The current UI reads, creates, edits, and deletes these records from the conversation workspace. It also subscribes to Realtime changes. The RLS policy scopes records to the owning `user_id`, requires conversation membership and active membership, and restricts `responsible_user_id` to a member of that conversation.

This table has no customer name, phone, email, source, independent contact identity, pipeline stage, deal owner outside the conversation, or activity-history model. It must not be repurposed as the CRM contact/deal table.

### Initial architectural implication

Keep conversation notes, conversation labels, classifications, and documents as existing workspace capabilities. A future CRM contact must be a separate business entity from `profiles` (registered app users) and from `private_conversation_notes` (conversation annotations). Any optional link to a conversation should preserve current conversation authorization rather than granting CRM access to its messages.

## 5. Backup and restore baseline

- Existing module: `modules/backup-restore.js`.
- Backup format: `bizmindmakers-chat-backup`, schema version 3.
- The explicit personal-table export/restore allowlists include `private_conversation_notes`, chat preferences, labels, classifications, and custom chat lists.
- The restore mapping explicitly rewrites ownership to the currently authenticated user for user-owned records.
- CRM tables are not present in the current allowlists or restore-column map.
- Conversation documents and message content are not part of this personal-table restore allowlist.

**CRM requirement:** any future CRM release must define export and restore support, ownership validation, relationship ordering, compatibility/versioning, and safe partial restore before claiming backup coverage.

## 6. Migration provenance and source-of-truth risks

### Repository SQL layout

The current source tree contains:
- 10 files under `supabase/migrations/`
- 45 files under `database/changes/`

The repository's own dependency DAG explicitly marks `database/changes/` as historical changes, not a canonical Supabase CLI sequence. The replay manifest and dependency DAG are marked BLOCKED; execution is disabled, SQL has not been executed by that replay plan, and the plan is not authorized for cloud/production execution.

Production has 62 migration-history records. Do not assume that the repository's historical SQL directory can be replayed alphabetically or treated as a complete clean-install sequence.

### Confirmed production/source divergence

- Production migration history includes `profile_status_video_media` and `allow_combined_profile_status_content_and_media`.
- Those two SQL files are in the open draft PR #138, not in the audited `main` source tree.
- PR #138 remains open/draft and unmerged. Its head is `b1cd63e04a59565ce511544701744bdc3417c4f6`; main remains at `67c7e46d26037ad0cf94a44aaf3a507c6a5171b4`.
- Consequently, production's status schema is ahead of the current main source in these two migration steps. The production DB has the change; main's UI/source has not incorporated the PR.
- PR #135 remains open/draft and unmerged. Its `chat_message_audio_duration` migration is documented by the PR as not applied to any database and is absent from production migration history.

### Other reproducibility gaps already documented in the repository

- `public.messages` is required by legacy policy/privilege SQL but is not created by canonical repository SQL; only a test-only compatibility fixture is supplied.
- Production contains the direct-conversation RPC implementation, but the reviewed canonical SQL set does not define it. A test-only fixture restores its inspected production definition for disposable replay; this is not yet a canonical production migration source.
- The reviewed dependency DAG remains `BLOCKED` and `executionAuthorized: false`.
- Historical SQL includes identity/data assumptions and must not be replayed against real accounts.

These issues should be reconciled in the migration provenance plan before CRM adds more schema dependencies.

## 7. Security and performance findings

### Positive controls

- All 28 application tables have RLS enabled and at least one policy.
- Private workspace notes are user-scoped and conversation-scoped.
- Private Storage buckets are used for chat media, conversation documents, channel/conversation avatars, and profile status media.
- The app uses the publishable Supabase client; no service-role key was found in the audited browser source.
- The current app's Service Worker does not cache authenticated Supabase data.

### High-priority least-privilege gap

The live catalog shows overly broad PostgreSQL privileges/default ACLs in the exposed `public` schema:

- `anon` currently has table privileges, including `TRUNCATE`, `REFERENCES`, and `TRIGGER`, on 13 public tables.
- `authenticated` currently has `TRUNCATE` on 15 public tables.
- Default privileges for objects created by `postgres` and `supabase_admin` in `public` grant broad table, sequence, and function privileges to `anon` and `authenticated`.
- RLS does not protect operations such as `TRUNCATE`; these grants are not proof that ordinary PostgREST requests can truncate tables or read rows outside RLS, but they violate least privilege and create an unsafe default for future public-schema objects.
- The repository contains a **test-only local overlay** and read-only assertions that revoke these broad grants/default ACLs. That overlay is explicitly not a production migration and has not been applied to production.

**CRM impact:** a new CRM table created in `public` may inherit these permissive defaults unless the migration explicitly establishes least-privilege grants and the default-ACL issue is addressed through a separately reviewed security change. This must be resolved before exposing CRM data.

### Advisor findings

- Security advisor: one warning for `public.set_conversation_image(uuid,text)`, an authenticated-callable `SECURITY DEFINER` function. The inspected body checks `auth.uid()`, active membership, conversation-management rights, and the expected private Storage path; its `search_path` is empty. Treat this as a targeted review item, not a proven authorization bypass.
- Security advisor: leaked-password protection is disabled in Supabase Auth.
- Performance advisor: 28 unused-index informational findings. Do not delete indexes based only on this advisory; validate workload/query plans first.
- Health advisor: no findings returned in this audit.
- One trigger function, `public.guard_chat_message_content_update()`, remains executable by `anon`/PUBLIC in the current catalog despite being trigger-oriented; the local-only least-privilege overlay explicitly revokes it.

No security remediation was executed during this phase.

## 8. PR and deployment boundary

| Item | Live state at audit | Baseline treatment |
|---|---|---|
| `main` | Commit `67c7e46d26037ad0cf94a44aaf3a507c6a5171b4` | Read-only baseline |
| PR #138 | Open, draft, unmerged | Do not treat as main source |
| PR #135 | Open, draft, unmerged; mergeability false at audit | Keep separate |
| Production database | Read-only catalog inspection | No DDL/DML |
| Production deployment | Not changed | No deployment |

No merge, deployment, or production migration was triggered.

## 9. Decisions required before CRM schema design

1. **Migration provenance:** agree how to reconcile the two production-applied status migrations that currently exist only in PR #138, without merging unrelated UI work automatically.
2. **Least privilege:** approve a separate, tested security-hardening plan for public-schema default ACLs and current broad table grants before creating CRM tables.
3. **CRM ownership model:** decide personal ownership versus explicitly shared team records; existing `responsible_user_id` semantics are conversation-member-bound and cannot be assumed to be CRM assignment semantics.
4. **Entity boundaries:** define contacts separately from app profiles; define deals/opportunities separately from order-status annotations in private notes.
5. **Conversation linking:** define optional links and authorization behavior without broadening access to messages.
6. **Backup contract:** specify CRM export/restore, ownership reassignment, relationship order, and schema compatibility.
7. **Reproducible database source:** close the documented canonical SQL gaps (legacy `messages`, direct-conversation RPC provenance, and blocked replay graph) before relying on clean-environment migrations.

## 10. Explicit non-actions

This phase did **not**:
- create or alter database tables, columns, indexes, policies, functions, triggers, buckets, or data;
- create CRM UI or application modules;
- modify `main`, merge PR #135/#138, or alter either PR;
- deploy to Vercel or GitHub Pages;
- apply any production migration or change Supabase settings.

**Conclusion:** the current platform already has conversation-centric workspace primitives that CRM should reuse by integration, not duplicate. A separate customer/lead/deal model is still needed, but schema design should wait until migration provenance and least-privilege defaults are resolved and the CRM ownership model is explicitly chosen.
