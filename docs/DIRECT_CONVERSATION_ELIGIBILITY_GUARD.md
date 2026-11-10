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

## Replay order

In a disposable local Supabase database only:

1. Apply the base schema and prerequisites in the reviewed local replay plan.
2. Apply `fixtures/direct-conversation-rpc.sql` to restore the authoritative
   function source and inspected ACL.
3. Apply `fixtures/direct-conversation-rpc-eligibility-guard.sql` as the
   test-only overlay.
4. Run runtime tests with synthetic Auth users and profiles.

## Required runtime cases

- eligible caller + eligible target: succeeds;
- suspended caller or target: rejected;
- unverified membership number on either side: rejected;
- malformed or missing membership number on either side: rejected;
- unconfirmed email on either side: rejected;
- unauthenticated caller, null target, and self-target: rejected;
- existing direct conversation is reused;
- concurrent reversed-pair calls create exactly one direct conversation;
- authenticated can call only the public wrapper, not the internal function;
- anon and PUBLIC cannot execute either function;
- service_role invocation without an authenticated user context is rejected.

## Safety state

- This overlay is under `tests/staging/local-supabase/fixtures/`.
- It is not a production migration.
- The original recovered fixture remains unchanged.
- No cloud SQL, production SQL, or data mutation has been run.
- Static contract tests do not constitute PostgreSQL runtime verification.
- DAG-014/DAG-015 remain blockers until the disposable local runtime suite passes.
