# Ultra Chat Pro 2.0

Modern Arabic-first real-time chat app built on GitHub Pages + Supabase Auth, Postgres RLS, Realtime and private Storage.

## Current architecture

- Static single-page frontend in `index.html` (no build step).
- Supabase Auth email/password sessions.
- `profiles`: public in-app profile directory (no email addresses stored here).
- `conversations` + `conversation_members`: direct and group membership.
- `chat_messages`: authenticated conversation messages, edits and soft deletes.
- Private `chat-media` Storage bucket. The app creates short-lived signed URLs for attachments.
- RLS is enabled on all chat tables. Anonymous table access is revoked.
- The legacy `public.messages` table is retained for rollback/data preservation but has no usable anonymous grants/policy.

## Supabase project

The frontend uses the project's publishable key only. Never put a service-role or secret key in browser code.

### Required Auth URL configuration

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://drmuhammednajeeb.github.io/my-chat-app/`
- Add the same URL to Redirect URLs.

Email confirmation may be enabled. If enabled, users must confirm their email before signing in. The signup flow sends the confirmation redirect back to the GitHub Pages app.

### Data API

Grant access is deliberately least-privilege:
- `authenticated`: access to profiles, conversations, memberships and chat_messages as required by the app.
- `anon`: no table access.
- Row access is still constrained by RLS.

If the project Data API has an explicit exposed-table allowlist, expose only:
`profiles`, `conversations`, `conversation_members`, `chat_messages`.
Do not expose the legacy `messages` table.

### Storage

The `chat-media` bucket is private. RLS policies permit only conversation members to read or upload files within their conversation folder. The app uses signed URLs for reading.

## Database migrations

The migration files in `supabase/migrations/` document the changes applied to the linked Supabase project. Apply them in order for a fresh environment.

## Deployment

GitHub Pages serves the repository root from the configured branch. Merge the approved upgrade branch into `main` to publish the new frontend. After deployment, test:
1. Sign up with a new email and confirm it.
2. Sign in and create a second test account.
3. Start a direct conversation by username.
4. Create a group and send messages.
5. Upload and open an image/PDF.
6. Verify an unauthenticated browser cannot read any chat tables.

## Known next-stage items

- Password recovery UI and account profile editing.
- Presence, unread counters, push notifications.
- Voice notes and WebRTC calls.
- Rate limiting, abuse reporting and moderation tooling.
- Automated browser/end-to-end tests.
