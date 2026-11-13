# Database object inventory and dependency review

## Canonical source layout

- `supabase/migrations/`: 62 SQL files, one for each version in the production migration ledger.
- `database/archive/`: 12 SQL files retained as non-executable provenance, pending forward reconciliation, or unapplied proposals.
- Duplicate active SQL copies: **0**.
- Test-only SQL fixtures in the replay plan: **17**.

The production migration ledger stores version/name metadata only; it does not retain the original SQL bodies. Recovered historical files, compound-source splits, and catalog reconstructions are therefore not claimed to be byte-identical to the original applied bodies unless independently proven.

## Reconstructed boundaries

| Production version | Canonical treatment |
|---|---|
| `20261106102326` / `20261106102443` | Final direct-conversation RPC implementation recovered from read-only catalog inspection; the second version is an explicit no-op. |
| `20261106125643` / `20261106125901` | Public-channel baseline and message-reaction foundation placed before the separate reaction user-FK index. |
| `20261106130351` / `20261106130540` / `20261106130804` | Message controls, team-admin prerequisite and group-limit trigger, followed by receipt Realtime and the pinned-by index. |
| `20261106132655` / `20261106132740` / `20261106132753` | Private channel/invite foundation, direct invite-table denial, and creator index. |
| `20261107032052` / `20261107032150` | Final direct-chat preference state is in the first version; the second is a documented no-op because an independent earlier body did not survive. |
| `20261107035217` / `20261107035243` / `20261107035443` | Avatar bucket, profile Realtime publication, and avatar object policies separated into versioned migrations. |
| `20261107152733` | Canonical function statement terminator repaired; the malformed original remains in archive provenance. |

Two unrecorded prerequisites were folded into existing ledger versions: public-channel baseline DDL before message reactions in `20261106125643`, and team-admin schema/policies/group-capacity trigger before message-pin policies in `20261106130351`. No real administrator identity is seeded.

## Archive policy

The archive is not part of Supabase CLI discovery or replay. It contains original compound-source provenance, the malformed pre-repair source, unrecorded baseline sources, a pending audio MIME reconciliation, a superseded team-admin reconciliation, and an unapplied chat-media proposal.

## Outstanding review gates

The canonical stream is assembled but not replay-authorized. Direct-conversation eligibility/concurrency (DAG-014 and DAG-015), least-privilege compatibility (DAG-016), managed Supabase prerequisites, RLS behavior, pgcrypto, pg_cron, and Storage path ownership still require disposable-local runtime evidence.

No SQL was executed against production during this reconciliation. The main branch remains unchanged.

## Conversation-image validation correction — 2026-11-13

A read-only PostgreSQL regex probe exposed an incorrect double-backslash suffix expression in the historical conversation-image trigger and RPC functions. The forward-only migration `202611130002_fix_conversation_image_extension_validation.sql` corrects both functions and the post-forward fixture verifies `.jpg`, `.png`, `.webp`, rejection of `.txt`, and the installed function definitions. It is now included in the canonical forward migration inventory and DAG; fresh disposable-local replay is pending. Production remains unchanged.
