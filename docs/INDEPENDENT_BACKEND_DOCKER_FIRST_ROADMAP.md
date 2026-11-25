# Independent Backend Migration Roadmap (Docker-first)

Date: 2026-11-25
Status: planning/audit only; no runtime, schema, production, or user-data changes.

## Direction
The project is to be progressively decoupled from Supabase. Docker is the preferred deployment and development packaging tool, but Docker is not itself a database, authentication service, or application backend. The replacement stack must be independently operable and must not require Supabase CLI, Supabase services, Supabase Auth, Supabase Storage, Supabase Realtime, or Supabase-hosted functions.

## Repository baseline observed
- The frontend is currently a GitHub Pages-oriented static application.
- Supabase-specific migrations, SQL security policies, functions, storage and realtime assumptions exist in the repository.
- A migration cannot safely be achieved by merely changing environment variables; the application currently relies on platform capabilities and security semantics.
- The current login-light feature PR remains separate and unmerged.

## Proposed target architecture (subject to design review)
- Docker Compose for reproducible service packaging.
- PostgreSQL as a standard self-managed database, not Supabase-managed.
- A separately implemented backend API as the only application access path to the database.
- Authentication/session implementation with password hashing, secure session handling, account recovery and rate limiting.
- Server-side authorization replacing reliance on RLS policies; all access checks must be tested.
- File/media storage via a self-hosted S3-compatible service or a carefully designed filesystem-backed service with backups; no public-by-default private media.
- WebSocket or SSE messaging and notifications owned by the backend.
- Secrets injected at runtime; never committed, bundled into static frontend assets, or printed in CI logs.
- Independent CI tests and deployment environment; no production migration until rollback and restore rehearsals pass.

## Migration stages
1. Inventory: map every client call, schema/table, RPC, auth flow, realtime subscription, storage bucket, edge function, policy and trigger to its application feature.
2. Threat model and data model: establish ownership, retention, encryption, permissions and audit requirements; document old-to-new mappings.
3. Backend foundation: API contract, schema migrations, health checks, test harness and Docker Compose for isolated development/CI.
4. Auth: implement and test sign-in, sign-up, invitation/membership verification, recovery, sessions, logout and abuse protections.
5. Chat core: conversation/member/message access, message lifecycle, receipts, edits, reactions, direct/group/channel rules and cleanup.
6. Media and ancillary features: uploads, avatars, voice, images, status, private documents, backup/restore.
7. Frontend adapter: switch behind a controlled adapter/feature flag and maintain compatibility until validation.
8. Data migration rehearsal: export, transform, import, consistency checks, reconciliation, restore and rollback rehearsal with non-production data.
9. Cutover: only with explicit approval, verified backups, monitoring and rollback plan.
10. Decommission Supabase references and secrets after successful cutover and retention/backup obligations are satisfied.

## Safety gates
- No production database changes or destructive operations during audit.
- No migration of real user data in this phase.
- Do not delete legacy SQL/migrations or credentials in this phase.
- Every stage should be isolated in a branch and reviewed with CI evidence.
- The user cannot currently access the local computer; use repository and cloud CI work only where supported, and do not represent cloud CI as visual/device testing.

## Immediate next task
Complete the inventory of frontend/backend dependencies and classify them by feature, data sensitivity, replacement complexity, test coverage and migration order.