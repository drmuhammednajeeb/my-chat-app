# Supabase Storage Bucket and RLS Audit — 2026-11-19

## Scope and method

This is a read-only production catalog review of Storage buckets, bucket-level visibility/limits, storage.objects RLS policies, object-table grants, and source references in the current application modules. No Storage object was read, written, removed, or modified in production, and no Storage policy or bucket configuration was changed.

## Bucket inventory

| Bucket | Public | Max file size | Allowed content types |
|---|---:|---:|---|
| avatars | yes | 3 MiB | JPEG, PNG, WebP |
| channel-avatars | no | 3 MiB | JPEG, PNG, WebP |
| chat-media | no | 12 MiB | JPEG, PNG, WebP, GIF, PDF, WebM/Ogg/MP4/MP3/WAV/AAC audio |
| conversation-avatars | no | 3 MiB | JPEG, PNG, WebP |
| conversation-documents | no | 25 MiB | PDF, JPEG, PNG, WebP |
| profile-status-media | no | 25 MiB | JPEG, PNG, WebP, MP4, WebM, QuickTime |

The public avatars bucket is consistent with the current profile-avatar code, which uploads to a user-ID-prefixed path and then uses getPublicUrl. The other five buckets are private and use authenticated upload/signed-read flows.

## storage.objects policy inventory

- RLS is enabled on storage.objects.
- There are 21 storage.objects policies.
- All 21 target authenticated; none target anon or PUBLIC.
- All policies scope access to a specific bucket.
- All write/read policies require active membership directly or through app_private.can_access_channel_avatar().
- The channel-avatars SELECT policy delegates active-member validation to can_access_channel_avatar(), which checks app_private.is_active_member() before testing public-channel or membership access.

## Bucket access model

- avatars: users upload/update/delete only under their own user-ID folder. Public delivery is intentional because the bucket itself is public.
- chat-media: members of the conversation can upload and read media; deletion is restricted to the Storage object owner. The current production upload policy checks conversation membership and active membership but does not bind the second path segment to auth.uid(). This is the already-identified uploader-folder ownership gap tracked in remediation item 2 / PR #153. Its forward migration adds the missing owner-folder condition and has passed disposable-local runtime verification; it remains unapplied to production.
- conversation-documents: upload path segment 2 must equal auth.uid(); metadata ownership and path are linked; private files are readable by the owner and shared files by conversation members; update/delete are owner-scoped.
- conversation-avatars: upload requires the conversation ID path segment, the caller's user-ID folder, active membership, and conversation-management permission. Reads are available to conversation members or active users viewing a public channel. Conversation managers can delete conversation avatar objects; this is a manager-level delete rule rather than uploader-only deletion.
- profile-status-media: upload/delete are user-folder scoped. Reads require a matching profile_statuses row, matching user-ID folder, and an unexpired status; the bucket remains private.
- channel-avatars: its policies scope upload/update/delete to a channel admin and the caller's user-ID folder; reads require active membership plus channel visibility/membership. No active upload reference was found in the current application HTML or JavaScript modules; the bucket is still referenced by the backup/restore validator as a recognized shared-asset type. Treat it as legacy/compatibility state until a full object inventory and backup compatibility review are completed. Do not delete the bucket or its objects.

## Excess table grants routed to remediation item 3

The anon role has SELECT/INSERT/UPDATE/DELETE table grants on storage.objects, but there are no anon-targeted storage.objects policies. RLS therefore blocks anon table access through the policy layer. These grants are unnecessary privilege surface and remain part of the default-grant cleanup tracked under remediation item 3 / DAG-016. The public avatars bucket's public object delivery is a separate Storage behavior and is intentional.

## Existing disposable-local runtime coverage

The current local-storage-rls-runtime.mjs probe covers:
- chat-media upload, cross-user uploader-folder spoof denial, and conversation-member signed reads;
- conversation-documents private/shared signed reads and non-owner delete denial;
- avatars owner upsert, cross-user overwrite denial, public delivery, and owner delete.

The runtime probe does not yet exercise conversation-avatars, profile-status-media, or the legacy channel-avatars bucket. Add explicit probes for the two active application buckets (conversation-avatars and profile-status-media). Keep channel-avatars as a separately marked legacy compatibility probe, or leave it unmodified until the product confirms whether it remains supported.

## Result and next action

The catalog shows no anon/PUBLIC Storage policies and every bucket-specific policy is bucket-scoped. The confirmed chat-media uploader-folder gap is already addressed by the separate forward migration in PR #153, not by a new production change here. The next engineering step is to extend disposable-local runtime coverage for conversation-avatars and profile-status-media, then review the resulting behavior before considering any policy changes.
