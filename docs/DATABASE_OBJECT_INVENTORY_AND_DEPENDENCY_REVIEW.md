# Database object inventory and dependency review

## Decision

**Static inventory status: READ-ONLY SOURCE REVIEW. Canonical bootstrap and production promotion remain BLOCKED.** This document's inventory parser reads repository files and application call sites; it is not itself a live catalog dump. Separately, the disposable-local runtime was executed successfully on 2026-11-11 (run [42990853351](https://github.com/drmuhammednajeeb/my-chat-app/actions/runs/42990853351)): 66 SQL files replayed with four declared test-only patches, followed by PostgreSQL, RLS, Storage, concurrency, pg_cron, browser direct-message, and bounded API-read checks. No production SQL or canonical migration was applied.

## Why this matters

This review maps database objects to real application features: login/profile provisioning, conversations, messages, reactions, pins, receipts, notifications, channels, workspaces, attachments, and Forever membership administration. A migration is not safe merely because it is syntactically valid; all referenced tables, functions, platform services, and authorization assumptions must exist in the correct order.

## Source scope

- **supabase/migrations/**: 10 candidate CLI migrations.
- **database/changes/**: 43 historical SQL changes, not a canonical CLI sequence.
- **index.html** and **membership.js**: browser-side RPC and table usage cross-checked against SQL.

The generated **build-database-object-inventory.mjs** report records source SHA-256 hashes and extracts table definitions/references, table alterations, function signatures, sequences, indexes, triggers, policies, constraints, extension declarations, Storage bucket IDs, Realtime publication entries, and cron usage.

**Limitation:** this is a static source inventory, not a catalog dump of a deployed database. It cannot prove which objects currently exist in production or whether a Supabase-managed service is initialized locally.


## Static inventory result (CI verified)

The read-only CI inventory covers **53 SQL files** and extracted **27 table definitions, 186 column declarations, 69 foreign-key declarations, 82 function definitions, 61 indexes, 19 triggers, 107 policies, and 65 GRANT/REVOKE statements**. It also records three byte-identical duplicate groups. These are source-parser counts, not a live database catalog count; multi-statement/conditional DDL and dynamic SQL still require PostgreSQL catalog validation during the later local rehearsal.

The test-only terminator patch is recorded in **fixtures/patch-manifest.json**. CI verified source SHA-256 `371e3b426ce5e2b47ba2cde669c2e32934baffae781ed684303a8e5cd5695088` and test-copy SHA-256 `fadf57b686cb4cfe1e6bb57c94a96a6859545cba4d1f650fe8dfc7a9c92d6b82`; the only byte-level change is the missing semicolon after the function body. The additional synthetic email and membership-number substitutions are recorded in **fixtures/synthetic-fixture-patches.json** with their own source and test-copy SHA-256 hashes. All canonical historical files remain unchanged.



## Application Storage contract review

The browser uses three buckets: **avatars**, **chat-media**, and **conversation-documents**. Repository SQL creates all three: avatars in the avatar-storage change, chat-media in the core chat migration, and conversation-documents in the workspace change. The source inventory confirms object policies for all three buckets; there is no missing bucket or missing chat-media policy.

A security-hardening opportunity remains: the canonical chat-media INSERT policy checks conversation membership but does not bind the second path segment (the uploader folder in the browser's conversation-id / user-id / generated-object path) to `auth.uid()`. The app currently constructs that path correctly, but the database does not independently enforce that path ownership. A test-only replacement policy adds this check in the disposable replay before the membership rewrite. This is a candidate for local RLS testing, not an approved production change.


## Supabase platform prerequisites

The source inventory confirms dependencies on Supabase Auth (`auth.users`), Storage (`storage.buckets` and `storage.objects`), the `supabase_realtime` publication, `pgcrypto` (including the `extensions` schema references), and `pg_cron` for scheduled cleanup. The repository still has no `supabase/config.toml`. These platform components must be explicitly enabled/configured in the local-only Supabase project before replay; the inventory does not prove that the local extension versions or schemas are available.

## RLS membership-gate source review

The static inventory extracted **107 policy definitions**. The membership base change contains a dynamic rewrite that appends the active-membership predicate to authenticated policies present when it runs. The dependency graph therefore places the feature SQL that creates policies before the membership rewrite. The inventory found **3 policy definitions with source timestamps after that rewrite**; all 3 contain a direct or indirect active-membership guard, and the static report found **0 later policies without a recognized guard**. This is a source-level result only: PostgreSQL RLS behavior, role semantics, and the dynamic policy rewrite still require local integration tests before security can be declared verified.

## Confirmed blockers

The unresolved direct-conversation RPC source can be retrieved without changing the deployed database using the read-only procedure in [RECOVER_DIRECT_CONVERSATION_RPC.md](RECOVER_DIRECT_CONVERSATION_RPC.md). The local replay remains disabled until its authoritative definitions are recovered and reviewed.

### 1. Legacy public.messages

Two CLI migrations reference **public.messages**, but no repository SQL creates that table. The current browser client reads and writes **public.chat_messages**; no client-side access to the legacy messages table was found. Both legacy migrations only need the table to exist for table-level policy and privilege operations; they do not reference its columns. A minimal empty compatibility stub is therefore appropriate for disposable local replay only. It is not a reconstruction of the deployed legacy table and must never be deployed or used to replace production schema.

### 2. Direct-conversation RPC source recovered; canonical migration still pending

The browser calls **public.get_or_create_direct_conversation(p_other_user_id)**. The authoritative definitions of **public.get_or_create_direct_conversation(uuid)** and **app_private.get_or_create_direct_conversation_impl(uuid)** were recovered from the deployed schema using read-only inspection and stored as a provenance-tracked test fixture. Their source and inspected ACL were used in the disposable-local replay; the eligibility matrix and 24 reversed-pair concurrency checks passed in run [42990853351](https://github.com/drmuhammednajeeb/my-chat-app/actions/runs/42990853351).

This closes the missing-source/bootstrap discovery gap, but it does not close production security: the deployed SECURITY DEFINER implementation still lacks the tested active-membership and verified-member eligibility guard. The next step is a reviewed canonical migration that preserves the recovered implementation, adds the approved guard, and proves exact ACL/search_path behavior. Do not promote the test-only fixture directly.

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


## Synthetic team-admin and membership fixtures

The historical team-admin seed and official-membership verification SQL contain fixed production identity assumptions. The disposable test plan now uses a reserved **admin@bizmindmakers.test** Auth identity and synthetic member number **971001000001**. The Auth row is seeded after the core schema but before the team-admin seed; the profile row is inserted after the membership base installs its profile guard. Test-only SQL copies substitute only the declared email/member-number literals, and the syntax-only copy adds only the missing semicolon. Each copy is checked byte-for-byte against its canonical source plus the declared replacement, with SHA-256 recorded by CI. Canonical SQL remains unchanged.

The DAG sequences the membership policy rewrite after every pre-membership policy source. The graph test checks that each such source has a dependency path into the membership rewrite node, preventing a future file from silently bypassing the dynamic RLS hardening step.

## Next safe steps

1. Convert the proven direct-conversation eligibility guard and chat-media uploader-folder ownership guard into reviewed canonical migration candidates; preserve the recovered RPC source and test exact ACL/search_path behavior.
2. Complete a per-table and per-sequence client privilege matrix. The current disposable overlay and CRUD tests do not yet prove a complete existing-object allowlist for every application feature.
3. Resolve the remaining canonical bootstrap decisions: the two historical references to **public.messages**, the declared test-only SQL terminator patch, and the absence of a committed canonical supabase/config.toml. Keep test-only compatibility objects and substitutions out of production.
4. Close the RPC contract: reconcile the 15 client-expected RPCs with the 20 production authenticated EXECUTE grants, classify legacy channel/admin wrappers, and ensure Trigger-only functions are not directly executable by API roles.
5. Extend Browser E2E so both users are connected and subscribed before sending; verify Realtime delivery, reconnect, groups/channels, attachments, reactions, edits/deletes, and third-party isolation.
6. Run bounded mixed read/write/Realtime/Storage load tests with duration and resource limits; the existing 200-request API read test is only a baseline.
7. Re-run the complete disposable runtime after canonical migration candidates and ACL assertions change. Only then submit a separate production-promotion review; do not merge or deploy as part of the test work.

## Safety invariants

- No **main** changes, merge, pull request, or deployment.
- No production database access or schema/data changes.
- No cloud Supabase credentials or non-loopback targets.
- No paid resources or cost-bearing infrastructure.
- No canonical SQL mutation; test-only copies must carry source hashes and patch records.
- Static audit success must never be described as SQL execution or backend E2E success.
