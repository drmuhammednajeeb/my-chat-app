# Backup & Restore — scope, guarantees, and operational limits

## Purpose

This is a **per-account backup** for the authenticated user. It is not a privileged, whole-platform database dump. Every database read and Storage operation runs under the signed-in user's Supabase session and is constrained by the deployed Row Level Security (RLS) and Storage policies.

The module does not use a service-role key, does not export authentication credentials, and does not change database schema, policies, RPCs, or production data structures.

## Export contents

The encrypted account package contains:

- Account profile snapshot: username/display name/bio/avatar URL; the avatar object is included when its URL identifies the account's own object in the `avatars` bucket.
- Account theme preference and the user's personal settings represented by the supported settings fields.
- Per-conversation preferences, mute/favorite/archive/shortcut state, starred messages, labels, classifications, classification rules, private notes, custom lists, and list assignments.
- The user's notifications as an export-only archive.
- Conversations the account can currently read under RLS, including visible non-deleted/non-expired messages, reactions, pins, memberships, group settings, membership event history, accessible private-reply contexts, and readable message-edit history.
- Conversation-document metadata and the binary objects visible to the account in `conversation-documents`.
- Referenced chat media in `chat-media`, the account's avatar object in `avatars`, and conversation/channel avatar objects in `channel-avatars` when the account can read them.

All included file bytes are embedded in the encrypted package. Export stops with an explicit error if a referenced object cannot be downloaded or if the configured binary/plaintext/file-size limits are exceeded. It does not silently produce a package labelled complete while omitting a referenced file.

## Restore behavior

Restore is deliberately **merge-only** and ownership-scoped:

- Account settings, profile display name/bio, personal preferences, labels, rules, classifications, notes, stars, custom lists, and list assignments are merged into the current account.
- A list assignment is restored only if the account is still a member of the referenced conversation.
- An account-owned message attachment is restored only when its original message still exists, still belongs to the account, and still points to the same storage path.
- An account-owned conversation document can be re-uploaded and its metadata restored only while the account remains a member of that conversation.
- An account avatar can be restored only to a path owned by the current account.
- Existing data is not deleted or truncated. A failed section can leave earlier sections restored; retry is designed to be idempotent where the target table's conflict keys permit it.
- The imported file must match the signed-in user's immutable Supabase user ID and pass authenticated decryption plus checksum validation.

## Archive-only content and intentional exclusions

Shared conversations, messages, reactions, pins, memberships, group settings, audit history, private-reply context, other members' files, and channel avatars are preserved as encrypted archive material. They are **not recreated in the live database**. Recreating shared objects would require coordinated identity, membership, role, ownership, foreign-key, and RLS handling; a client-side restore must not impersonate other participants.

Notifications are exported but not restored because the current application policies do not provide a user-safe insert path for them. Username, membership number/status/verification, other users' profiles, authentication users/passwords, access/refresh tokens, service keys, and session secrets are not modified or restored.

## Whole-platform disaster recovery is separate

A full platform recovery must be performed by an authorized project operator using Supabase's managed backup/PITR facilities or a controlled database dump plus a separately secured Storage-object backup. That operation includes global schema, RLS, functions/RPCs, migrations, all accounts, and all Storage objects. It must never be implemented by placing a service-role credential in the browser or in this repository.

This module therefore must be described as a complete **account-level export within the user's RLS-visible scope**, not as a full backup of every user's application data or the Supabase project.

## Cryptographic and file format controls

- AES-256-GCM authenticated encryption.
- PBKDF2-HMAC-SHA-256 with 310,000 iterations, a random 16-byte salt, and a random 12-byte IV.
- SHA-256 payload checksum in addition to the GCM authentication tag.
- Minimum passphrase length 12 characters; maximum 256 characters.
- Version 2 export format; version 1 files remain readable for backward compatibility.
- Maximum 65 MiB of raw included binary objects, 100 MiB plaintext payload, and 140 MiB encrypted file.
- The passphrase is not sent to Supabase, stored in browser storage, or included in logs. Losing it makes the backup unrecoverable.

The checksum detects accidental inconsistency; it is not a digital signature and does not prove who created a backup.

## Required acceptance tests before release

1. Export with a real test account that has personal preferences, labels, lists, notes, notifications, messages, reactions, pins, and attachments.
2. Confirm the downloaded file cannot be read as plaintext and that the same password validates it.
3. Confirm wrong password, tampered ciphertext, malformed JSON, unsupported schema, oversized file, and another user's backup are rejected before any write.
4. Restore into the same account and verify personal rows, list references, profile fields, avatar, own attachments, and owned documents.
5. Confirm shared messages/conversations/memberships are not inserted, updated, or deleted.
6. Confirm inaccessible/deleted conversations and stale message references are skipped and reported.
7. Simulate a mid-restore failure, retry, and verify there are no duplicate personal rows.
8. Test the export and restore flows in current desktop and mobile browsers, including PWA update from the prior service-worker cache.
9. Keep one encrypted copy on the user's external drive and another encrypted copy in a separate physical/off-site location. Do not rely on one USB device as the only backup.

Static checks and syntax checks are necessary but do not replace these authenticated browser acceptance tests.
