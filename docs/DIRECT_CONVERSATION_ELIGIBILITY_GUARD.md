# Direct conversation eligibility guard — test-only

## Purpose

This is a separately reviewed test overlay for the recovered
`app_private.get_or_create_direct_conversation_impl(uuid)` function.
It enforces the approved rule that **both participants** must have:

- `profiles.membership_status = 'active'`
- `profiles.membership_number_verified = true`
- a membership number matching `^971[0-9]{9}$`
- `auth.users.email_confirmed_at IS NOT NULL`

The caller is checked through the existing `app_private.is_active_member()`
predicate. The target is checked directly against `public.profiles` and
`auth.users`. No authorization decision uses user-editable metadata or JWT
claims.

## Concurrency and locking

The overlay locks both eligible profile and Auth rows using
`FOR SHARE OF p, u`, in stable UUID order, before the conversation lookup or
creation. This keeps the eligibility rows stable for the transaction. The
original per-pair advisory transaction lock, exact-two-member lookup, and
existing-conversation reuse are preserved.

## Synthetic fixture order

The Auth and profile fixtures deliberately straddle membership-trigger creation:

1. Apply core schema prerequisites.
2. Apply `synthetic-auth-admin-before-membership.sql` and
   `synthetic-direct-chat-auth-before-membership.sql` before `membership.base`
   installs Auth signup/profile triggers. The synthetic Auth users use reserved
   `.test` addresses and unique test membership values.
3. Apply the reviewed feature dependencies and `membership.base`.
4. Apply `synthetic-admin-profile-after-membership.sql` and
   `synthetic-direct-chat-profiles-after-membership.sql` after the profile guard
   exists and before the official-membership verification rewrite. The
   missing-profile identity is intentionally left without a profile.
5. Apply the test-copy official membership verification, anchor, and final
   membership-format steps in the reviewed DAG. The admin RPCs in the runtime
   suite set verified states and the suspended state through the actual
   authorization path; no trigger is disabled.

## Runtime order

In a disposable local Supabase database only:

1. Complete the reviewed base, feature, membership, Auth, Storage, and Realtime
   dependency replay.
2. Apply `fixtures/direct-conversation-rpc.sql` to restore the authoritative
   function source and inspected ACL.
3. Apply `fixtures/direct-conversation-rpc-eligibility-guard.sql` only after
   the final membership-format migration.
4. Run `fixtures/direct-conversation-eligibility-runtime.test.sql`. It checks
   eligible success, caller/target rejection cases, self/null/unauthenticated
   boundaries, reuse, and RPC ACL inside a transaction that ends in ROLLBACK.
5. Run `node tests/staging/local-supabase/direct-conversation-concurrency.mjs`
   with `LOCAL_SUPABASE_DB_URL` set to the disposable local
   `postgres@127.0.0.1:54322/postgres` URL. It launches two independent psql
   sessions in reversed participant order, requires one shared conversation
   ID, and cleans up only the test conversation.

The concurrency runner refuses non-loopback hosts, non-default local DB ports,
and non-postgres database users. It is not part of CI and has not been run.

## Required runtime cases

- eligible caller + eligible target: succeeds;
- suspended caller or target: rejected;
- unverified membership number on either side: rejected;
- malformed or missing membership number on either side: rejected;
- unconfirmed email on either side: rejected;
- target with no profile or no matching Auth user: rejected;
- unauthenticated caller, null target, and self-target: rejected;
- existing direct conversation is reused;
- all six membership validation functions and both membership-format constraints use the final `971` plus nine-digit format;
- the official membership admin RPC rejects an invalid number;
- concurrent reversed-pair calls create exactly one direct conversation;
- authenticated can invoke the public wrapper and the internal function according to the recovered ACL; the internal function still enforces caller and target eligibility;
- anon and PUBLIC cannot execute either function;
- service_role invocation without an authenticated user context is rejected.

## Safety state

- This overlay is under `tests/staging/local-supabase/fixtures/`.
- It is not a production migration.
- The original recovered fixture remains unchanged.
- No local SQL, cloud SQL, production SQL, or data mutation has been run.
- Static contract tests do not constitute PostgreSQL runtime verification.
- DAG-014/DAG-015 remain blockers until the disposable local runtime suite passes.
