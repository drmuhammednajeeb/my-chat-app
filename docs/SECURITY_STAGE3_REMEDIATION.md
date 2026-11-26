# Stage 3 security remediation package

## Scope and safety
- Forward-only, narrowly scoped ACL reconciliation and disposable-DB assertions.
- Revokes only TRUNCATE, REFERENCES, TRIGGER and (PostgreSQL 17+) MAINTAIN; ordinary CRUD grants are intentionally preserved.
- No live production SQL, Auth settings, Storage policies, extension relocation, or deployment changed.
- CI disposable Supabase replay and regressions passed on PR #188 candidate (98 SQL files); review and merge approval remain separate gates.

## Finding disposition
- **Excess table control ACLs:** revoke selected table control privileges from anon, authenticated, and PUBLIC; assertions fail if anon/authenticated still have effective privileges.
- **SECURITY DEFINER delete RPC:** reviewed endpoint; body authenticates, requires active membership and conversation membership, author-only ownership and DB-clock 15-minute window. Keep authenticated EXECUTE pending a compatibility-tested redesign.
- **app_private.message_cleanup_queue:** worker-only queue; no client policy.
- **pg_net in public:** unresolved dependency/platform review; do not relocate before dependency tests.
- **Leaked-password protection:** configuration follow-up; not changed.
- **Storage:** isolated cross-user, cross-conversation, inactive-member and upsert runtime probes passed in the disposable CI stack; production policies remain unchanged.

## Validation completed
1. Candidate migrations and test fixtures replayed on disposable local Supabase: 98 SQL files.
2. Stage 3 ACL reconciliation migration executed successfully.
3. Local Supabase SQL manifest audit passed (112/112).
4. Chat regression, message lifecycle, and Forever membership-format regressions passed.
5. Storage API/RLS, message auto-cleanup Storage runtime, and browser-authenticated two-user Realtime E2E passed.
6. Synthetic browser E2E confirmed cross-session delivery, durable history after reload, cross-conversation isolation, and zero production requests.
7. Disposable stack stopped and destroyed.

## Remaining review / deployment gates
- Independent final code review and PR approval.
- Review pg_net extension dependencies before any relocation.
- Auth leaked-password protection remains a separate configuration follow-up.
- Production rollout requires separate explicit approval; this PR has not changed production.
