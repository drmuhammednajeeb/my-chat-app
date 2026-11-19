# Cron, Triggers, pg_net, and Auth Security Audit — 2026-11-19

## Scope and safety

This review used read-only PostgreSQL catalog queries, cron history aggregates, Vault secret metadata, Supabase Security Advisor, and Edge Function request logs. No trigger, cron job, extension, Vault secret, Auth setting, queue row, or production object was changed. Secret values and HTTP request headers/bodies were not queried.

## Trigger inventory

All user-defined triggers inspected in auth, public, and storage are enabled in origin mode:

| Schema | Triggers | Enabled | Disabled |
|---|---:|---:|---:|
| auth | 2 | 2 | 0 |
| public | 18 | 18 | 0 |
| storage | 11 | 11 | 0 |

Application SECURITY DEFINER trigger functions are owned by postgres and have an explicit empty search_path. Supabase-managed Storage triggers are owned by supabase_storage_admin and use pg_catalog where a function-level search_path is set. No disabled application trigger was found.

The auth.users triggers enforce invited signup and create the member profile. Public triggers cover message notifications, conversation timestamps, reply-parent validation, message expiry, cleanup-queue protection, membership notifications/audit, group limits, conversation image validation, official-channel flag protection, profile-status expiry, and profile membership-field protection.

## Scheduled cleanup architecture

Two active pg_cron jobs are present:

1. purge-expired-chat-messages — every five minutes; calls app_private.purge_expired_chat_messages(), which delegates to app_private.enqueue_expired_chat_messages(). It queues eligible messages and old unreferenced chat-media objects; it does not delete Storage objects.
2. message-auto-cleanup-worker — every five minutes; sends a Vault-backed request to the message-auto-cleanup Edge Function through pg_net.

The Edge Function verifies the per-project Vault token and uses the service-role client to claim queue items, delete Storage objects through the Storage API, checkpoint Storage deletion, then delete eligible message rows and dependent metadata. The queue is retryable. Pinned messages and official conversations are exempt. The queue was empty at the time of this review.

## Seven-day cron history and 24-hour Edge Function observations

| Job | Runs in seven days | Succeeded | Failed | Average DB job duration |
|---|---:|---:|---:|---:|
| purge-expired-chat-messages | 2,016 | 2,016 | 0 | ~29 ms |
| message-auto-cleanup-worker | 579 | 579 | 0 | ~58 ms |

The worker's pg_net request uses the default 5,000 ms timeout. In the last 24 hours:

- 274 Edge Function invocations were logged with HTTP 200.
- Average Edge Function execution time was approximately 3,166 ms.
- Maximum observed execution time was approximately 4,902 ms.
- pg_net stored 72 response records, 69 successful and 3 timed out at approximately 5,000 ms.
- There were no pending pg_net requests and no pending message-cleanup queue items.

This is not evidence of data loss or a failed cron job. It does show that the 5-second HTTP timeout has little headroom relative to observed Edge Function execution time. A 10-second timeout is proposed for future scheduling.

## Forward timeout remediation

Migration 20261119130000_increase_message_cleanup_http_timeout.sql replaces only the owner-only scheduler function so that future scheduling uses timeout_milliseconds := 10000.

Important deployment boundary: this migration does not reschedule or mutate the existing cron job. After the migration is separately approved and applied, an owner-only call to app_private.configure_message_auto_cleanup(project_url) is required to replace the existing five-minute job with the new timeout. That call unschedules the previous job and schedules a new one using the existing Vault secret names. Do not run it without explicit production-change approval.

The scheduler remains SECURITY DEFINER with empty search_path, requires session_user = postgres, validates the project URL against the allowlist, and reads the backend key from Vault. The four required Vault secret names were present; their values were not read.

## pg_net and pg_cron privilege boundary

- pg_net version 0.20.4 is installed with the extension namespace recorded as public; its API functions are in the net schema.
- PUBLIC has USAGE on net and default EXECUTE on pg_net functions. has_function_privilege reports those inherited privileges for anon/authenticated.
- anon and authenticated are NOLOGIN roles. The net schema is not exposed through the default Supabase Data API schema set; however, the actual project's exposed-schema setting was not available through the read-only database interface in this review.
- No user-callable public or app_private function was found that bridges an API caller into net. The only application function referencing net is app_private.configure_message_auto_cleanup(text), which is SECURITY DEFINER, owned by postgres, and executable only by postgres; it also checks session_user = postgres.
- cron schema USAGE is false for anon/authenticated, despite inherited function/table privilege checks returning true. cron scheduling is therefore not exposed through the normal Data API schema boundary.
- Vault decrypted-secret table grants were limited to service_role among the API roles checked.

Supabase's current pg_net guidance explains that net is not exposed through the Data API by default, anon/authenticated are NOLOGIN, and the platform-managed extension grants cannot necessarily be revoked by postgres. Do not attempt a blind REVOKE, ALTER EXTENSION SET SCHEMA, or DROP EXTENSION. Moving pg_net requires a controlled drop/recreate plan, checking pending requests, Database Webhooks, scheduled jobs, and reconfiguration. The current queue is empty, but stored response records exist and the worker is active.

References:
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/kb/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16

## Security Advisor observations

The current Security Advisor returned three findings:

1. INFO — app_private.message_cleanup_queue has RLS enabled and no policies. The table is in a non-exposed private schema, and table privileges are revoked from anon/authenticated/service_role. This is intentional queue isolation, not a missing public-table policy.
2. WARN — pg_net extension is installed in public. This is a platform/extension-placement warning; do not relocate it without the controlled plan above.
3. WARN — leaked password protection is disabled. This is a Supabase Auth project setting, not a SQL policy or migration. No connected Auth-settings action was available in this review. It requires a separate explicit approval and change in Supabase Auth settings.

## Migration-ledger reconciliation warning

The production catalog contains the active cleanup queue, functions, cron jobs, Vault secret names, and Edge Function calls described above, but the queried supabase_migrations.schema_migrations ledger did not contain version 20261117130000. Treat this as a source/ledger provenance discrepancy. Do not blindly replay the historical cleanup migration or assume its migration-history state; reconcile the live object definitions and the ledger before any production migration application.

## Result

- Trigger inventory: all inspected application triggers enabled.
- Cron jobs: both active; seven-day cron run history had zero job-level failures.
- Cleanup queue: empty.
- Edge worker: 274 observed HTTP 200 responses in the last 24 hours; three pg_net 5-second timeouts warrant more headroom.
- Timeout fix: forward migration prepared; current cron job unchanged until separately approved owner-only reconfiguration.
- pg_net placement and leaked-password protection: external/platform settings requiring a controlled plan and explicit approval.
