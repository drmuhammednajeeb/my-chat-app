# Database source reconciliation — 2026-11-12

## Result

The production migration ledger contains **62 applied versions**. The canonical Supabase CLI directory contains **66 ordered migration files**: the 62 historical version/name entries plus four new forward-only hardening migrations that are explicitly marked as not applied to production.

| Source class | Count | Execution status |
|---|---:|---|
| Historical production-ledger migrations | 62 | Metadata/name parity verified; original SQL body equivalence is not claimed |
| New forward-reconciliation migrations | 4 | Passed disposable-local replay; not applied to production; production execution unauthorized |
| Canonical CLI migration files | 66 | Exact one-to-one source-to-DAG mapping |
| Archived SQL provenance / pending / unapplied | 12 | Never executable by Supabase CLI |
| Test-only SQL fixtures in replay plan | 19 | Disposable-local only |
| Duplicate active source copies | 0 | None |

## Source reconstruction decisions

The production ledger stores version/name metadata only. It does not preserve original SQL bodies. The registry therefore distinguishes recovered source bodies, compound-source splits, catalog reconstructions, syntax repair, and deliberate no-op versions; it does not claim original-body equivalence where that cannot be proved.

- Public-channel baseline DDL is folded before the message-reaction DDL in `20261106125643`.
- Team-admin schema, policies and group-capacity trigger are folded before message-pin policies in `20261106130351`; no real administrator identity is seeded.
- Message-reaction, message-control, private-channel, direct-preference and avatar compound sources are split across their production version numbers.
- The surviving direct-preference final-state source is assigned to `20261107032052`; `20261107032150` is a documented no-op.
- The original malformed membership function source is retained in archive; canonical `20261107152733` has the missing statement terminator.

## Disposable-local runtime evidence

Latest complete validation on commit `c97b36d3a603380cb80dd6cde2374ea1d3438731`:

- SQL manifest audit: **77/77 tests passed** (workflow run `43258867403`).
- Disposable local Supabase replay: **83/83 SQL files passed** (workflow run `43258867470`).
- Supabase Auth, Storage, Realtime schemas and roles passed preflight.
- pgcrypto schema and function resolution passed.
- Temporary pg_cron scheduler probe executed successfully.
- 24 reversed-pair concurrent direct-conversation requests converged on one conversation.
- 40 concurrent authenticated message writes persisted uniquely.
- Post-forward eligibility, RPC ACL, least-privilege, active-membership RLS, and rollback-only CRUD/RPC assertions passed.
- Storage upload, signed reads, document sharing, avatar upsert, and cross-user path-denial probes passed.

These tests ran on a disposable local Supabase stack only. They do not represent a production migration or production data change.

## External production-release residuals

1. The four forward migrations remain unapplied in production. They require a separately approved deployment window and a production migration plan.
2. Production `supabase_admin` default ACLs still grant API-role defaults. The production `postgres` migration role is not a member of that managed superuser role and cannot alter its defaults. Read-only inspection found zero current public relations or functions owned by `supabase_admin`; migration `20261112160002` fails closed if that ownership appears. Supabase-level review is still required.
3. Supabase Auth leaked-password protection is disabled. This is a project Auth setting, not a SQL migration; enable it through the project Auth security settings before production release.
4. Security Advisor's `public.set_conversation_image` SECURITY DEFINER warning is intentional: the function checks actor identity, active membership, conversation-manager rights, and actor-owned object path; its source is covered by a dedicated regression test and the production ACL excludes PUBLIC/anon.
5. The 28 unused-index notices are informational only. No index was removed without workload evidence.

## Safety and approval

- No production SQL was executed.
- No production schema, ACL, or data was changed.
- `main` was not modified.
- PR #139 remains unmerged; the branch is ready for final human review.
- Production execution remains unauthorized until the external residuals and forward-migration deployment plan are accepted.
