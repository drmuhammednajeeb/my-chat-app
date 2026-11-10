# Recover the direct-conversation RPC source

## Why this is required

The browser calls \`public.get_or_create_direct_conversation(p_other_user_id => ...)\`. The privilege-hardening migration also alters \`app_private.get_or_create_direct_conversation_impl(uuid)\`. Neither function definition is present in the reviewed repository SQL set.

Do not invent an implementation. The function controls direct-conversation identity, membership creation, duplicate prevention, and access boundaries. A guessed replacement could create duplicate conversations or weaken isolation.

## Read-only source extraction

Run this query in the existing Supabase project's SQL Editor using a read-only inspection session. It performs no DDL, DML, migration, or configuration change.

\`\`\`sql
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  p.proacl::text as function_acl,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where
  (n.nspname = 'app_private' and p.proname = 'get_or_create_direct_conversation_impl')
  or
  (n.nspname = 'public' and p.proname = 'get_or_create_direct_conversation')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
\`\`\`

## What to return

- Every row returned by the query, including both function definitions if present.
- If the query returns no rows, report that explicitly.
- Do not paste passwords, API keys, JWTs, service-role keys, or other secrets. The query does not request them.

## Acceptance checks before replay

1. Confirm the public RPC argument name and return type match the browser call.
2. Confirm the internal implementation signature matches the hardening migration.
3. Review authorization, target-user validation, transaction behavior, and duplicate-conversation handling. The recovered function checks `auth.uid()` and target-profile existence, but does **not** contain an explicit active-membership predicate; review where membership eligibility is enforced before approving runtime behavior.
4. Restore the authoritative source into a test-only SQL copy and record its source provenance and SHA-256.
5. Add regression tests for concurrent creation, unauthenticated/null/self/missing-profile targets, exact function ACLs, and existing conversation reuse. Test active-membership gating separately after its intended enforcement point is established.
6. Only then reconsider enabling the local PostgreSQL replay.

**This is a source-recovery request only. It is not permission to modify the deployed database.**
