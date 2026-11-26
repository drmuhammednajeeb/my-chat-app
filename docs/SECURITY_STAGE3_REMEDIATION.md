# Stage 3 security remediation package

## Scope and safety
- Forward-only, narrowly scoped ACL reconciliation and disposable-DB assertions.
- Revokes only TRUNCATE, REFERENCES, TRIGGER and (PostgreSQL 17+) MAINTAIN; ordinary CRUD grants are intentionally preserved.
- No live production SQL, Auth settings, Storage policies, extension relocation, or deployment changed.
- Isolated replay and regression validation are required before merge.

## Finding disposition
- **Excess table control ACLs:** revoke selected table control privileges from anon, authenticated, and PUBLIC; assertions fail if anon/authenticated still have effective privileges.
- **SECURITY DEFINER delete RPC:** reviewed endpoint; body authenticates, requires active membership and conversation membership, author-only ownership and DB-clock 15-minute window. Keep authenticated EXECUTE pending a compatibility-tested redesign.
- **app_private.message_cleanup_queue:** worker-only queue; no client policy.
- **pg_net in public:** unresolved dependency/platform review; do not relocate before dependency tests.
- **Leaked-password protection:** configuration follow-up; not changed.
- **Storage:** isolated cross-user, cross-conversation, inactive-member and upsert tests remain required.

## Validation gate
1. Replay migrations on disposable local Supabase DB.
2. Run `supabase/tests/stage3_acl_assertions.sql`.
3. Run CRUD/RPC and sequence regression tests.
4. Storage negative/positive tests, including upsert.
5. Review pg_net/extension dependencies and Auth leaked-password configuration.
6. CI and independent review; production rollout requires separate explicit approval.
