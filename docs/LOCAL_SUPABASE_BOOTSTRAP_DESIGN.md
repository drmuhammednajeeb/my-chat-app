# Local Supabase bootstrap design

## Source of truth

The production ledger contains 62 migration versions. The canonical CLI directory contains 62 files named exactly `<version>_<migration_name>.sql`. The non-executable archive contains 12 SQL files and is excluded from Supabase CLI discovery.

Migration metadata records version and name only; it does not preserve original SQL bodies. The source registry labels recovered, reconstructed, split, repaired, and folded versions explicitly.

## Dependency reconstruction

- Public-channel baseline DDL is placed before message-reaction DDL in `20261106125643`; the baseline had no independent production ledger version.
- Team-admin schema, policies, and group-capacity trigger are placed before message-pin policies in `20261106130351`. The migration does not seed an administrator identity.
- Message-reaction, message-control, private-channel, and avatar compound sources are split into separate versioned files.
- The direct-preference source is final-state only; `20261107032150` is a documented no-op.
- Canonical `20261107152733` has the required function-statement terminator; the original malformed source is archived.
- The two direct-conversation RPC versions are represented by a catalog-recovered final implementation and an explicit no-op version.

## Replay constraints

The current graph is not replay-authorized. A disposable environment must verify managed Auth/Storage/Realtime prerequisites, extension placement, pg_cron behavior, membership/RLS transitions, direct-conversation eligibility and concurrency, least-privilege grants, and chat-media path ownership.

First-admin assignment is a controlled operational step, not a hardcoded SQL seed. Production-only audio MIME configuration remains a separate pending reconciliation item. The unapplied chat-media proposal remains archive-only.

No local replay, production migration, or cloud SQL operation is authorized by this design.
