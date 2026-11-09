# Read-only SQL manifest audit

## Purpose

This is the first safe implementation step toward an ephemeral local Supabase test environment. It inventories SQL inputs and identifies bootstrap blockers. It does not execute SQL, start Docker, contact Supabase Cloud, or modify source SQL.

## Run locally

```bash
node tests/staging/local-supabase/audit-sql-manifest.mjs
node --test tests/staging/local-supabase/audit-sql-manifest.test.mjs
```

The auditor emits a JSON report containing:

- SQL file counts and source classification for `supabase/migrations/` and `database/changes/`.
- SHA-256 hashes and byte-identical duplicate groups.
- Numeric migration ordering where a timestamp prefix exists.
- Heuristic public-table references and table definitions.
- Qualified references to legacy `public.messages`, separately classified from `public.chat_messages`.
- A conservative syntax-hazard heuristic for a dollar-quoted function body followed by another statement without a visible semicolon.
- Missing local Supabase CLI configuration and unresolved legacy-table dependencies.
- An explicit `bootstrap.executable: false` decision.

## Execution boundaries

- `supabase/migrations/` is inventoried as the CLI migration candidate directory.
- `database/changes/` is historical SQL and is never automatically merged into the migration sequence.
- Duplicate files are reported only. No file is deduplicated, skipped, rewritten, or deleted.
- The report is a static audit, not a SQL parser or proof that migrations are semantically valid.
- Do not interpret an ordered filename list as an approved execution plan.
- The CI workflow uses only a standard GitHub-hosted runner, Node.js, and repository contents. It has no Supabase credentials, no cloud project, and no service-role key.

## Current gate

The repository's audited SQL history still references `public.messages` without defining that legacy table in the migration set, contains one suspected missing function terminator in `database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql`, and has no `supabase/config.toml`. Therefore the bootstrap remains **BLOCKED**. The next step is a human-reviewed test-only schema/fixture plan; it must not change canonical migration files.

## What this does not test

This stage does not parse or execute the SQL against PostgreSQL, start Supabase, exercise Auth/RLS/Realtime/Storage, run full-app E2E, or measure backend concurrency. The syntax check is heuristic and is not a substitute for a PostgreSQL parser. Those stages remain **NOT RUN** until a separately reviewed local-only bootstrap exists.
