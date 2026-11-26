# Stage 3 Security Hardening — Live Read-only Audit (2026-11-26)

## Scope and safety
This report records a read-only catalog/advisor audit of the hosted Supabase project and source-main baseline at commit db38bc983fa8f687bc5c45558f9fb0772ba9fce6. No hosted DDL, DML, storage object changes, auth configuration changes, or production deployment were performed. This report is not proof of exploitability and findings require targeted disposable-local tests before remediation.

## Verified observations

### RLS
All application tables listed in the live public-schema catalog snapshot had row-level security enabled. This does not establish policy correctness or protect privileges such as TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN.

### Excess table privileges
Live effective privilege counts show:
- anon: REFERENCES, TRIGGER and TRUNCATE on 13 public tables each.
- authenticated: REFERENCES, TRIGGER and TRUNCATE on 15 public tables each.
These privileges are outside row-policy enforcement and should be removed from client roles after compatibility validation in a disposable environment.

### Default privileges
The live public-schema default ACL catalog snapshot for postgres owner includes broad grants to anon and authenticated for table, function, and sequence objects. The supabase_admin-owned default ACL rows also exist. Remediation must avoid altering Supabase-managed role defaults; restrict changes to application migration-owner defaults and validate migration owner assumptions.

### SECURITY DEFINER
Security Advisor reported public.delete_message_secure(p_message_id uuid) executable by authenticated as SECURITY DEFINER. This may be an intentional client RPC but requires review of body, ownership checks, caller/member authorization, and test coverage before changing ACLs.
Other cleanup worker SECURITY DEFINER endpoints in the observed ACL snapshot were restricted to service_role.

### Storage
RLS is enabled on Storage tables inspected. Buckets:
- public: avatars (public delivery appears intentional)
- private: channel-avatars, chat-media, conversation-avatars, conversation-documents, profile-status-media
Live table ACL snapshot showed anon privileges on storage.objects (SELECT, INSERT, UPDATE, DELETE). These are unnecessary direct privileges if policy/config contract permits revocation; test first.

### Security Advisor
Current live advisor findings:
1. INFO — RLS enabled without policy: app_private.message_cleanup_queue. This is likely intentionally private/worker-only; confirm role-access expectations, don't add a permissive policy.
2. WARN — extension_in_public: pg_net extension in public schema. Review relocation compatibility and dependency constraints before moving.
3. WARN — authenticated_security_definer_function_executable: public.delete_message_secure(p_message_id uuid).
4. WARN — auth_leaked_password_protection: leaked-password protection disabled. This is an Auth dashboard setting and requires a separately approved configuration change.

## Remediation sequence (branch-only, local test required)
1. Reconcile effective privilege and default ACL inventory with current migrations; do not modify supabase_admin-managed ACLs.
2. Create forward migration(s) revoking non-RLS privileges from anon/authenticated and narrowing application-owner default ACLs, with explicit role and ownership guards.
3. Preserve only tested client CRUD/RPC grants; assess delete_message_secure function body and wrapper before revocation or conversion.
4. Add disposable-local runtime assertions for table/sequence/function ACLs, default ACLs, active membership policies, and storage.objects.
5. Extend tests for Storage uploader-folder binding and cross-user denial.
6. Prepare a separate Auth-setting remediation checklist for leaked-password protection; no dashboard change in this PR.
7. Run the complete disposable-local Supabase replay, assertions, CRUD/RPC compatibility and Storage runtime tests.
8. Independent review before merge; production deployment requires separate explicit approval.

## Status
Audit evidence captured. Remediation not yet applied. No production changes. No merge or deployment.
