# SECURITY DEFINER and RPC Audit — 2026-11-19

## Scope and method

This review used read-only catalog queries against the production Supabase project on 2026-11-19. It inspected PostgreSQL function definitions, owners, SECURITY DEFINER flags, per-function ACLs, function-level settings, the app_private schema ACL, and the RLS policies that consume selected helper functions. No production DDL, DML, migration, or configuration change was performed.

The remediation is proposed in PR #154 on branch security/privileged-rpc-active-membership-guards-20261119. Its migration is forward-only and remains unapplied to production.

## Production catalog baseline

| Check | Observed result |
|---|---:|
| SECURITY DEFINER functions in public + app_private | 55 |
| Functions owned by postgres | 55 |
| Functions with no function-level search_path setting | 0 |
| SECURITY DEFINER functions executable by anon | 0 |
| SECURITY DEFINER functions executable by PUBLIC | 0 |
| SECURITY DEFINER functions executable by authenticated | 25 |
| SECURITY DEFINER functions with dynamic SQL detected in their definitions | 0 |
| app_private schema USAGE for authenticated | yes |
| app_private schema USAGE for anon, service_role, and PUBLIC | no |
| app_private schema CREATE for authenticated, anon, and PUBLIC | no |

There are 50 SECURITY DEFINER functions in app_private and 5 in public. The five public-schema SECURITY DEFINER functions are message-cleanup worker endpoints and are executable by service_role, not by anon or authenticated.

All 55 functions have an explicit function-level search_path setting and are owned by postgres. No dynamic SQL statement was detected by the catalog source scan. These results are a catalog snapshot, not a proof that every function's business logic is correct.

## Confirmed authorization gaps in the production definitions

The following privileged write paths did not independently serialize the caller's active membership state before performing SECURITY DEFINER writes:

1. app_private.can_manage_conversation(uuid) checked owner/admin membership but did not require active membership. This helper is consumed by RLS policies and privileged RPCs.
2. app_private.create_channel_invite(uuid) relied on that helper and did not independently lock/validate the caller's verified active membership.
3. app_private.join_channel_by_invite(text) checked authentication and invite validity but did not require an active, verified, email-confirmed member before inserting a conversation membership.
4. app_private.transfer_group_ownership_impl(uuid,uuid) checked the current owner and target administrator role, but did not validate the active eligibility of either the caller or the target administrator.
5. app_private.create_channel(text,text,boolean), app_private.join_public_channel(uuid), and app_private.set_conversation_image_impl(uuid,text) checked active membership through is_active_member(), but did not hold row locks that serialize those writes against a concurrent membership suspension.
6. The four administrator mutation implementations (admin_create_official_member_invites_impl, admin_revoke_member_invite_impl, admin_set_member_official_number_impl, and admin_update_membership_status_impl) relied on is_team_admin() → is_active_member() without locking the acting administrator's membership rows for the duration of the mutation.

The direct-conversation implementation is tracked separately under remediation item 1 / PR #153 and is not replaced by PR #154.

## PR #154 forward remediation

The forward migration 20261119113000_harden_privileged_rpc_active_membership.sql now:

- Adds an active-membership predicate to can_manage_conversation.
- Adds locked checks against both public.profiles and auth.users for channel creation, invite creation, invite-based joining, public-channel joining, and conversation-image changes.
- Requires both the current group owner and the target administrator to be active, verified, and email-confirmed before ownership transfer.
- Adds app_private.lock_active_member() and uses it before administrator mutation RPCs, retaining the existing is_team_admin() authorization check.
- Preserves the public RPC wrappers as SECURITY INVOKER and explicitly revokes PUBLIC/anon execution on the replaced internal functions before granting the required authenticated execution.

The row locks use FOR SHARE OF p, u; a concurrent suspension or verification-state update must wait until the privileged operation completes, preventing a stale pre-write membership check from racing the update.

## Runtime coverage added

The rollback-only disposable-local SQL fixtures now exercise rejection of:

- A suspended member joining a channel by invite.
- A suspended member joining a public channel.
- A suspended member creating a private or public channel.
- A suspended owner creating a channel invite, transferring group ownership, or changing the conversation image.
- Transfer of group ownership to a suspended administrator.
- A suspended member being reported as eligible by lock_active_member().

The SQL assertion fixture also verifies that the new and replaced SECURITY DEFINER implementations retain locked active-membership checks, administrator mutations call lock_active_member(), and public RPC wrappers remain SECURITY INVOKER.

## Remaining audit observations

- app_private.enforce_chat_message_reply_parent() was a trigger-returning SECURITY DEFINER function with an unnecessary authenticated EXECUTE grant. PR #154 now revokes direct PUBLIC/anon/authenticated execution while retaining the existing trigger attachment; the disposable-local message lifecycle and runtime checks must confirm trigger execution remains intact.
- public.guard_chat_message_content_update() is also a trigger function whose ACL includes anon/authenticated execution. Review trigger-only function ACLs as part of the least-privilege pass; do not revoke until trigger behavior is verified in disposable runtime.
- RLS and function ACLs are separate layers. This RPC audit does not close the separate table-by-table SELECT/INSERT/UPDATE/DELETE policy audit (remediation item 5).

## Deployment boundary

PR #154 is not merged. Its forward migration has not been applied to production. Do not mark this remediation as production-complete until the latest disposable-local runtime, SQL manifest audit, regression workflows, and independent review all pass, and a separate production deployment approval is given.
