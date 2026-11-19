# Public Table RLS and CRUD Policy Audit — 2026-11-19

## Scope and method

This was a read-only catalog review of the production Supabase project on 2026-11-19. It enumerated public base tables, RLS flags, table owners and grants, every public policy and command, role targets, policy expressions, and API-role RLS bypass flags. No production DDL, DML, migration, or configuration change was performed.

## Inventory results

| Check | Observed result |
|---|---:|
| Public base tables | 25 |
| Tables with RLS enabled | 25 / 25 |
| Tables with RLS disabled | 0 |
| Tables with no RLS policy | 0 |
| Tables with FORCE ROW LEVEL SECURITY | 0 |
| Public-table policies | 53 |
| SELECT policies | 15 |
| INSERT policies | 12 |
| UPDATE policies | 10 |
| DELETE policies | 6 |
| Authenticated-targeted policies | 52 |
| Authenticated policies without an active-membership predicate | 0 |
| Policies targeted to anon/PUBLIC | 1 |

The single anon-targeted policy is an explicit false/false deny policy on the legacy public.messages table. It does not grant anon access.

All 52 authenticated-targeted public policies include app_private.is_active_member() in either USING or WITH CHECK. No public table has more than one policy for the same command, so there is no same-command permissive-policy OR stacking in this inventory. All 53 policies are PERMISSIVE; there are no RESTRICTIVE policies.

The authenticated and anon roles have neither SUPERUSER nor BYPASSRLS. service_role and postgres have BYPASSRLS, which is expected for their privileged platform/application roles and must be treated separately from normal user access.

## CRUD design notes

The missing per-command policies are not automatically defects. Several tables are intentionally append-only, soft-delete-only, or system-managed:

- chat_messages has SELECT/INSERT/UPDATE policies but no authenticated DELETE policy; deletion is handled through the application's message lifecycle rather than direct row deletion.
- conversation_member_events is read-only to authenticated members; writes are system/trigger managed.
- message_edit_history is SELECT/INSERT only and is designed as an append-only audit trail.
- message_pins supports SELECT/INSERT/DELETE but not UPDATE.
- private_reply_contexts supports SELECT/INSERT but not UPDATE/DELETE.
- profiles supports SELECT/UPDATE but not direct INSERT/DELETE.
- user_notifications supports SELECT/UPDATE but not direct INSERT/DELETE.
- user_settings and user_chat_preferences support SELECT/INSERT/UPDATE but no direct DELETE policy.

These should remain as designed unless application behavior or a specific test demonstrates a required operation is missing.

## Least-privilege observation routed to remediation item 3

The production catalog still shows anon holding 91 table-privilege grants across 13 public tables:

- chat_list_items
- chat_lists
- conversation_documents
- conversation_group_settings
- conversation_member_events
- private_conversation_notes
- private_reply_contexts
- user_classification_rules
- user_conversation_classifications
- user_conversation_label_items
- user_conversation_labels
- user_conversation_settings
- user_message_stars

RLS is enabled on every one of these tables, and none of their policies targets anon. This catalog result does not establish an anon data-access path; the grants are nevertheless unnecessary privilege surface and are tracked under remediation item 3, which remains gated by the existing platform/default-privilege review DAG-016.

## Profile-directory privacy check

The profiles SELECT policy exposes profile rows to active authenticated members. The table includes username, display name, avatar URL, bio, membership number, membership status, and membership-number verification state; it does not contain an email column. The current application source uses membership_number and membership_number_verified in the user directory search/display flow. Therefore, broad active-member profile visibility appears consistent with the current directory feature. This is an application behavior observation, not a privacy-policy approval; any future decision to hide membership numbers should be handled as an explicit product change and would require a safe directory projection/view or column-level grant design.

## Result

No missing RLS enablement or missing public-table policy was found in this catalog pass. No additional policy migration is justified from the inventory alone. Keep the intentional append-only/soft-delete operations intact. Continue with row-by-row expression and cross-user runtime checks, and keep the anon table-grant cleanup in remediation item 3 rather than mixing it into this policy audit.
