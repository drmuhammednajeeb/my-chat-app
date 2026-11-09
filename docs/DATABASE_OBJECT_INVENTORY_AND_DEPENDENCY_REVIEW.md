# Database object inventory and dependency review

## Decision

**Status: BLOCKED — source inventory and dependency design only.** This work reads repository files and application call sites. It does not connect to a database, execute SQL, create Supabase configuration, or modify canonical SQL.

## Why this matters

This review maps database objects to real application features: login/profile provisioning, conversations, messages, reactions, pins, receipts, notifications, channels, workspaces, attachments, and Forever membership administration. A migration is not safe merely because it is syntactically valid; all referenced tables, functions, platform services, and authorization assumptions must exist in the correct order.

## Source scope

- **supabase/migrations/**: 10 candidate CLI migrations.
- **database/changes/**: 43 historical SQL changes, not a canonical CLI sequence.
- **index.html** and **membership.js**: browser-side RPC and table usage cross-checked against SQL.

The generated **build-database-object-inventory.mjs** report records source SHA-256 hashes and extracts table definitions/references, table alterations, function signatures, sequences, indexes, triggers, policies, constraints, extension declarations, Storage bucket IDs, Realtime publication entries, and cron usage.

**Limitation:** this is a static source inventory, not a catalog dump of a deployed database. It cannot prove which objects currently exist in production or whether a Supabase-managed service is initialized locally.

## Confirmed blockers

### 1. Legacy public.messages

Two CLI migrations reference **public.messages**, but no repository SQL creates that table. The current browser client reads and writes **public.chat_messages**; no client-side access to the legacy messages table was found. Both legacy migrations only need the table to exist for table-level policy and privilege operations; they do not reference its columns. A minimal empty compatibility stub is therefore appropriate for disposable local replay only. It is not a reconstruction of the deployed legacy table and must never be deployed or used to replace production schema.

### 2. Missing direct-conversation RPC implementation

The browser calls **public.get_or_create_direct_conversation(p_other_user_id)**. The privilege-hardening migration also alters **app_private.get_or_create_direct_conversation_impl(uuid)**. Neither function is defined in the reviewed SQL source set. This is a hard bootstrap blocker and a potential application feature gap. Recover the authoritative function definition from the intended source or deployed schema before designing a compatibility fixture. Do not create a guessed implementation.

### 3. Forever membership format conflict

The browser-side **membership.js** and **index.html** validate **^971[0-9]{9}$**. The historical manual-verification SQL temporarily defines **admin_create_official_member_invites_impl(jsonb)** and **admin_set_member_official_number_impl(uuid,text)** using **^971001[0-9]{6}$**. The final CLI migration **20261108075913** explicitly includes both functions in its six-function allowlist and rewrites them to the nine-digit format, alongside the profile and invitation constraints.

This is an intentional staged transition, not a missing-function defect. The test manifest must apply the final CLI migration after the historical membership SQL, assert that exactly six function definitions were updated, and verify that both admin RPCs accept only the final **971 + nine digits** format. Do not run app acceptance tests in the intermediate state.

### 4. Confirmed SQL terminator defect

**database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql** closes the function body with the dollar delimiter and starts REVOKE without the required semicolon. Preserve the historical file; any correction must be a test-only copy with its own SHA-256 and patch record.

### 5. Missing team-admin prerequisite

The membership base SQL calls **app_private.is_team_admin()** and reads **app_private.team_admins**. Those are provided by **database/changes/team_management_dashboard.sql**, so that change must precede the membership system. The privilege-hardening migration also depends on the team-admin and group-limit functions.

### 6. Platform-managed dependencies

Before any local SQL rehearsal, assert availability of:

- Supabase Auth schema, **auth.users**, **auth.uid()**, and roles.
- Supabase Storage schema, **storage.buckets**, **storage.objects**, and **storage.foldername(text)**.
- **supabase_realtime** publication.
- **pgcrypto** functions in the schema referenced by SQL (**extensions.digest**, **extensions.gen_random_bytes**).
- **pg_cron** and its **cron.job**, **cron.schedule**, and **cron.unschedule** interfaces.

No cloud project or credentials are required or permitted.

### 7. Dynamic policy rewrite review

The membership SQL dynamically rewrites all authenticated policies present at that point to add **app_private.is_active_member()**. Policies created later are not automatically rewritten. Review every later policy for the intended active-member requirement before claiming consistent membership enforcement.

### 8. Historical data assumptions

Historical SQL includes fixed identity/email assumptions and data updates. Do not replay those against real accounts. Use synthetic Auth users and test-only data transformations. No production data is to be copied.

## Dependency design

**reviewed-dependency-dag.json** records platform prerequisites, source nodes, known edges, unresolved references, duplicate provenance, and blockers. It is deliberately marked **BLOCKED** and **executionAuthorized: false**. It does not define an executable all-files order.

Key dependency chains:

1. Supabase Auth + Storage + Realtime + a minimal test-only legacy messages stub → core chat schema.
2. Core schema → team-admin infrastructure, chat preferences, reactions, pins/receipts, channel support, and notifications.
3. Team-admin + preferences + core schema → group management and workspaces.
4. Public-channel schema + team-admin + pgcrypto → private-channel invitation functions.
5. Team-admin + core schema → membership base → official membership validation → final-format migration, after resolving the format conflict.
6. Group expiry schema + pg_cron → scheduled purge.

The three duplicate pairs are recorded with one proposed canonical test source each. This is provenance only; no source is deleted or changed.

## Next safe steps

1. Recover the authoritative direct-conversation RPC source and verify whether it exists in the intended schema without changing it.
2. Prove the staged Forever membership-number format transition: historical 971001 + six digits, followed by the final migration updating all six functions and constraints to 971 + nine digits.
3. Decide the legacy **public.messages** replay treatment based on actual historical compatibility needs.
4. Review the dynamic membership-policy rewrite and all later policies.
5. Build the explicit test-only allowlist and fixtures only after the blockers are resolved.
6. Run PostgreSQL parse/apply rehearsal in a disposable local environment.
7. Start Supabase Local only after rehearsal and loopback/network guards pass.

## Safety invariants

- No **main** changes, merge, pull request, or deployment.
- No production database access or schema/data changes.
- No cloud Supabase credentials or non-loopback targets.
- No paid resources or cost-bearing infrastructure.
- No canonical SQL mutation; test-only copies must carry source hashes and patch records.
- Static audit success must never be described as SQL execution or backend E2E success.
