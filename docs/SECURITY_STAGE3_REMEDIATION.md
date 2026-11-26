# Stage 3 security remediation package

## Scope and safety
- Forward-only ACL reconciliation migration and disposable-DB assertions.
- No live production SQL, Auth settings, Storage policies, extension relocations, or deployment were changed.
- This migration requires isolated migration replay and compatibility tests before merge.

## Finding disposition
- **Excess table control ACLs:** migration explicitly revokes anon table privileges and authenticated/PUBLIC TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on PG17+), with fail-closed catalog assertions.
- **SECURITY DEFINER delete RPC:** intentional supported endpoint. Its inspected body authenticates, requires active membership and conversation membership, author-only ownership, and a DB-clock 15-minute window. Keep EXECUTE for authenticated; treat Advisor warning as accepted/ documented until a wrapper/privileged schema design can be compatibility-tested.
- **app_private.message_cleanup_queue RLS/no policy:** worker-only queue; no client policy should be added.
- **pg_net in public:** unresolved platform/dependency review; do not relocate until cron/http dependencies and function references are tested.
- **Leaked-password protection:** configuration checklist item; not changed here.
- **Storage:** existing chat-media uploader path policy was inspected in migrations; run isolated cross-user/cross-conversation negative tests and upsert compatibility before signoff.

## Validation required before merge
1. Supabase local migration replay on disposable DB.
2. ACL assertions in `supabase/tests/stage3_acl_assertions.sql`.
3. CRUD/RPC regression tests for client tables and sequences.
4. Storage tests: wrong uploader folder, non-member conversation, inactive membership, authorized upload/read, upsert.
5. Review extension/pg_net dependencies and Auth leaked-password configuration separately.
6. CI and independent review; production rollout requires separate explicit approval.
