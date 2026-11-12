# Local SQL manifest audit

## Canonical discovery

The audit treats only `supabase/migrations/` as executable migration input. It contains 62 SQL files matching the 62 production ledger version/name entries.

The `database/archive/` directory contains 12 SQL files for source provenance, pending forward reconciliation, and unapplied proposals. The audit inventories these separately; archived SQL is never part of migration ordering or CLI replay.

## Audit invariants

- Every production ledger version has one canonical filename.
- No duplicate active SQL copies remain.
- The archive is excluded from migration execution and replay ordering.
- Test-only SQL fixtures are explicitly listed and remain separate from production migrations.
- The original malformed membership source is archived; canonical `20261107152733` has the required statement terminator.
- The unapplied chat-media proposal remains archived and is not represented as applied production SQL.

## Current gate

The manifest and dependency graph are design/review artifacts only. A clean disposable Supabase replay, PostgreSQL runtime tests, and catalog parity review have not been completed. The missing local Supabase configuration and outstanding runtime/security blockers must be resolved before replay authorization.

No cloud or production SQL execution is permitted by this audit.
