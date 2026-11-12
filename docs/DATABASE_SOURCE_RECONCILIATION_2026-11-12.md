# Database migration source reconciliation — 2026-11-12

## Status

**RECONCILIATION INCOMPLETE — NO MIGRATION REPLAY AUTHORIZED**

This document and `supabase/migrations/source-registry.json` establish a read-only mapping between the current `main` SQL source tree and the live Supabase production migration metadata. They do not claim that all production SQL bodies have been recovered or that the repository can yet bootstrap a clean database.

- Repository baseline: `67c7e46d26037ad0cf94a44aaf3a507c6a5171b4`
- Production project: `lvkeohpuucuklagvwpnq`
- Production migration records: 62
- SQL files in `supabase/migrations/`: 10
- SQL files in `database/changes/`: 45
- Duplicate source copies: 3
- Source files in the two production-oriented directories: 55

## Why simply merging the folders is unsafe

The production migration ledger stores migration versions and names, not the original SQL bodies. Filename similarity is not proof that a source file's content is identical to what was applied. Several production migrations were applied as separate steps while the repository keeps the related SQL in compound historical files. A clean, deterministic migration stream therefore requires explicit source-boundary and content review, not a mass rename.

## Current source layout

| Directory | Role | Policy |
|---|---|---|
| `supabase/migrations/` | 10 existing CLI migration files | Existing stream; contains unresolved legacy dependencies and is not a complete bootstrap by itself |
| `database/changes/` | 45 historical feature/change files | Historical source collection, not an executable CLI sequence |
| `tests/staging/local-supabase/fixtures/` | Synthetic fixtures, compatibility stubs, overlays and recovered definitions | Test-only; never production migrations |

Three duplicate pairs are already identified by byte-for-byte SHA-256 evidence. The reviewed canonical copy is the `supabase/migrations` version for chat privilege hardening, notifications, and notification indexes. The duplicate historical copies must remain preserved until the canonical migration history and replay tests are approved.

## Production mapping findings

The machine-readable registry lists all 62 production migration records and the source path candidates for each.

The following records are not yet backed by a verified canonical source:

- `atomic_direct_conversation_creation` and `hide_atomic_direct_rpc_implementation`: only a test fixture containing the inspected final production function definitions and ACLs was recovered. It is not the original pair of migration bodies, and the later test-only eligibility overlay remains unvalidated.
- `channel_visibility_avatar_group_background`: no authoritative source file was identified in `main`.
- `harden_channel_rpc_wrappers`: a candidate source defines wrappers, but the distinct production hardening step is not independently verified.
- `profile_status_video_media` and `allow_combined_profile_status_content_and_media`: the source files are in open draft PR #138, not in `main`. They must be brought into the canonical source stream through an explicitly reviewed change; do not merge the unrelated UI PR merely to recover SQL.
- Other records mapped to compound historical files are candidates only. Their individual production migration boundaries have not been proven from the metadata ledger.

The exact status of each record is in `source-registry.json`.

## Existing replay design is intentionally blocked

The repository's `replay-manifest.json` is `DESIGN_ONLY` / `BLOCKED`, and `reviewed-dependency-dag.json` has `executionAuthorized: false`. Remaining blockers include:

1. Direct-conversation RPC runtime behavior, eligibility checks, ACL and concurrency validation (DAG-014/015).
2. Public-schema default ACL / least-privilege overlay and authenticated CRUD compatibility (DAG-016).
3. Auth, Storage, Realtime and extension readiness in disposable local Supabase.
4. pgcrypto schema/function resolution and pg_cron runtime behavior.
5. Membership migration application and runtime RLS checks.
6. Chat media path ownership enforcement and storage RLS behavior.

A passing static inventory test is not evidence of SQL execution or a successful clean bootstrap.

## Canonicalization strategy

The target is one authoritative forward migration stream under `supabase/migrations/`, with the following controlled transition:

1. Recover and review the original SQL for every production migration not represented by a verified source.
2. For each compound historical source, identify exact production migration boundaries. Split only where the SQL semantics and production ordering can be proven; do not duplicate an entire compound script under multiple migration versions.
3. Assign each forward migration the exact production version/name from the live ledger where it represents an already-applied migration.
4. Preserve original source blobs and SHA-256 provenance in the registry. Retain historical copies in an explicitly non-executable archive until parity is proven.
5. Keep test fixtures and synthetic patches under `tests/staging/local-supabase/fixtures/`, with source hashes and patch manifests; never move them into production migrations.
6. Build a fresh disposable database from the proposed canonical stream and run catalog parity, RLS negative tests, RPC ACL/concurrency tests, Storage/Realtime tests, and extension/cron checks.
7. Only after a clean replay and exact catalog comparison, mark the registry `RECONCILED` and enable the documented local replay path.
8. For the existing production database, do not replay historical migrations. Once source parity is proven, preserve the existing migration ledger and use forward-only migrations for subsequent changes.

## Non-actions in this reconciliation commit

- No production SQL was applied.
- No database objects, data, policies, grants, buckets, or functions were changed.
- No existing migration file was renamed, moved, deleted, or rewritten.
- No Supabase local stack was started.
- No PR was merged, and no deployment was triggered.
- `main` remains unchanged.

## Exit criteria

This work is complete only when:
- all 62 production migration records have verified authoritative SQL source and content provenance;
- every source SQL file is classified as canonical, archived, duplicate, or test-only;
- the canonical stream has one deterministic dependency order and no unresolved object references;
- a disposable clean replay passes;
- the replayed catalog matches production for application-owned objects and security properties;
- the production migration ledger is preserved without destructive repair or reset.
