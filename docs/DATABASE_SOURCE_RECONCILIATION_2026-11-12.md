# Database source reconciliation — 2026-11-12

## Result

The production migration ledger contains 62 versions. The working branch contains exactly 62 canonical SQL files under `supabase/migrations/`, each named with its production version and migration name.

| Source class | Count | Execution status |
|---|---:|---|
| Canonical production migration files | 62 | Review required; not execution-authorized |
| Archived SQL provenance / pending / unapplied | 12 | Never executable |
| Duplicate active source copies | 0 | Removed from the active source layout |
| Test-only SQL fixtures in replay plan | 17 | Disposable test-only inputs |

## Source reconstruction decisions

The ledger stores version/name metadata only. It does not preserve original SQL bodies. The registry therefore distinguishes recovered source bodies, compound-source splits, catalog reconstructions, syntax repair, and deliberate no-op versions; it does not claim original-body equivalence where that cannot be proved.

- Public-channel baseline DDL is folded before the message-reaction DDL in `20261106125643`.
- Team-admin schema, policies and group-capacity trigger are folded before message-pin policies in `20261106130351`; no real administrator identity is seeded.
- Message-reaction, message-control, private-channel, direct-preference and avatar compound sources are split across their production version numbers.
- The surviving direct-preference final-state source is assigned to `20261107032052`; `20261107032150` is a documented no-op.
- The original malformed membership function source is retained in archive; canonical `20261107152733` has the missing statement terminator.

## Non-executable archive

`database/archive/` contains 12 SQL files: compound-source provenance, unrecorded production baseline sources, the original pre-repair membership source, a pending forward reconciliation for audio MIME configuration, a superseded team-admin reconciliation, and an unapplied chat-media proposal. Supabase CLI discovery is restricted to `supabase/migrations/`.

## Safety and remaining work

- No production SQL was executed.
- No production schema or data was changed.
- `main` was not modified.
- PR #139 remains an isolated draft review surface.
- A clean disposable replay and catalog parity check are still required.
- Runtime blockers DAG-014, DAG-015 and DAG-016 remain open.
- Production chat-media audio MIME configuration remains a separate pending reconciliation item, not silently inserted into the historical 62-version stream.
