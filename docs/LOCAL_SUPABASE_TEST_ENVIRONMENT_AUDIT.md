# Local Supabase test-environment audit

## Repository state

- Canonical production migration files: 62.
- Production ledger versions: 62.
- Non-executable archived SQL files: 12.
- Duplicate active SQL copies: 0.
- Test-only SQL fixtures in the replay plan: 17.

All canonical migration filenames match their production version/name entries. Historical source provenance and unregistered proposals are isolated from the CLI migration directory.

## Safety

The archive is not replay input. Synthetic administrator data is created only by a dedicated test fixture after the canonical team-admin schema exists. No real administrator email or identity is seeded by the production migration stream.

The production database has not been modified, and no SQL was executed during this repository reconciliation.

## Remaining validation

The repository is not yet cleared for a clean local replay. The dependency graph retains runtime blockers for direct-conversation RPC eligibility/concurrency and least-privilege compatibility, plus platform, RLS, extension, scheduler and storage-policy checks. These must pass in a disposable local Supabase environment before the migration stream can be declared complete.
