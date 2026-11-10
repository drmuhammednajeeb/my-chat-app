# Catalog State Recovery — Missing Migration Sources — 2026-11-10

**Source:** read-only PostgreSQL catalog queries against the existing `my-chat-app` Supabase project.  
**Purpose:** preserve the current deployed state for comparison while the original migration bodies remain missing.  
**Safety:** no production DDL/DML or ACL/policy changes were executed.

This document is a snapshot of current catalog state, **not a reconstruction of the original historical migration files**. Do not use it as a migration to apply to another database.

## 1. `tighten_direct_chat_preference_scope` — version `20261107032150`

The repository contains `database/changes/user_specific_direct_chat_preferences.sql`, which creates `public.user_chat_preferences` and its initial user/membership-scoped policies. That source does not match the final live policies exactly.

The live table currently has three authenticated policies:

- SELECT — `user_id = auth.uid()`, the caller is present in `conversation_members` for the target conversation, and `app_private.is_active_member()`.
- INSERT — the same ownership, membership, and active-member predicates in WITH CHECK.
- UPDATE — the same predicates in both USING and WITH CHECK.

The final live policy names are:
- `Users read own conversation preferences`
- `Users create own conversation preferences`
- `Users update own conversation preferences`

The source file's original policy names and direct-conversation type restriction differ. The historical SQL corresponding to this remote ledger entry is not present in the current repository. The final live policy may reflect this and/or later policy-hardening migrations; the exact delta cannot be attributed without the original body. Preserve the current policy expressions from `pg_policies` in the approved catalog snapshot before any new canonical baseline is created.

## 2. `channel_visibility_avatar_group_background` — version `20261107160647`

The current live schema exposes these relevant columns:

### `public.conversations`

| Column | Type | Nullability | Default |
|---|---|---|---|
| `description` | text | NOT NULL | empty string |
| `is_public` | boolean | NOT NULL | false |
| `avatar_path` | text | NULL | none |

### `public.conversation_group_settings`

| Column | Type | Nullability | Default |
|---|---|---|---|
| `background_theme` | text | NOT NULL | `'default'` |

### Current channel access policy state

- `Members can view conversations`: authenticated callers may read a conversation if they are a member or a team admin, and must also pass `app_private.is_active_member()`.
- `Authenticated users create conversations`: generic client inserts are restricted to `direct` and `group`; channel creation is performed through the reviewed RPC path.
- `Owners and group admins update conversations`: owner, channel/group manager, or team-admin group path, with active-member guard.
- Conversation membership read/write policies also include active-member checks.

The original migration file is not present. The current columns and policy expressions are documented here for baseline comparison only.

## 3. `harden_channel_rpc_wrappers` — version `20261107160733`

The current catalog contains six app-private implementation functions and six public wrappers:

| Function family | Implementation schema | Public wrapper | Implementation security | Search path | Observed API EXECUTE |
|---|---|---|---|---|---|
| Create channel | `app_private.create_channel(text,text,boolean)` | `public.create_channel(text,text,boolean)` | SECURITY DEFINER | empty | authenticated |
| Create private channel | `app_private.create_private_channel(text,text)` | `public.create_private_channel(text,text)` | SECURITY DEFINER | empty | authenticated |
| Create channel invite | `app_private.create_channel_invite(uuid)` | `public.create_channel_invite(uuid)` | SECURITY DEFINER | empty | authenticated |
| Join by invite | `app_private.join_channel_by_invite(text)` | `public.join_channel_by_invite(text)` | SECURITY DEFINER | empty | authenticated |
| Discover public channels | `app_private.discover_public_channels(text,integer,integer)` | `public.discover_public_channels(text,integer,integer)` | SECURITY DEFINER | empty | authenticated |
| Join public channel | `app_private.join_public_channel(uuid)` | `public.join_public_channel(uuid)` | SECURITY DEFINER | empty | authenticated |

The public wrappers are SECURITY INVOKER SQL functions with an empty search path. The observed wrapper ACLs grant EXECUTE to `authenticated` and `service_role`; app-private implementation ACLs grant EXECUTE to `authenticated`. The implementations have an empty search path and perform authorization internally.

Behavior observed in the current function definitions:

- Channel creation requires an authenticated active member, validates title/description length, creates a `channel` conversation, and inserts the creator as owner.
- Private channel creation delegates to channel creation with `is_public = false`.
- Invite creation requires `app_private.can_manage_conversation()`, revokes previous live invites for the channel, creates a random token, stores only its SHA-256 hash, and sets a seven-day expiry.
- Invite joining validates token format, hash lookup, revoked/expired state, use limits, channel type, and inserts the caller as a member.
- Public channel discovery requires an active member and returns only `channel` rows with `is_public = true`.
- Joining a public channel requires an active member and a public channel, then inserts membership idempotently.

The original wrapper-hardening migration file is not present in the repository. This catalog record is not a substitute for the historical source and must not be replayed as a migration.

## 4. Additional index confirmation

Read-only `pg_indexes` inspection confirmed:

- `public.message_reactions_user_id_idx` on `message_reactions(user_id)`.
- `public.message_pins_pinned_by_idx` on `message_pins(pinned_by)`.

These live definitions support the bundled source candidates listed in the migration reconciliation matrix; they do not prove exact original migration boundaries.

## 5. Recovery disposition

| Remote migration | Original SQL source | Current catalog state | Next action |
|---|---|---|---|
| `20261107032150 tighten_direct_chat_preference_scope` | Missing | Policy expressions captured above | Recover historical file from Git history/releases; otherwise document as catalog-recovered baseline only |
| `20261107160647 channel_visibility_avatar_group_background` | Missing | Current columns and policy state captured above | Recover original DDL from Git history/releases; compare current schema and constraints |
| `20261107160733 harden_channel_rpc_wrappers` | Missing | Current wrapper/implementation signatures, ACLs and behavior captured above | Recover historical source; review exact grants and wrapper changes before canonical rebuild |

No original migration body has been invented. All three remain historical-source gaps even though the currently deployed state has been inspected.
