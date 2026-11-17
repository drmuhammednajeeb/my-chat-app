# Message Auto-Cleanup Edge Function

This worker removes eligible message media through the Supabase Storage API before deleting message rows.

## Deployment

Deploy this function with JWT verification disabled because the scheduled caller uses a Vault-held per-project token which the function validates through the service-role-only `verify_message_cleanup_token` RPC:

```sh
supabase functions deploy message-auto-cleanup --no-verify-jwt
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` or the Vault token to the browser.

## Activation order

1. Deploy this Edge Function with `--no-verify-jwt`.
2. Apply the reviewed database migration.
3. As the database owner, configure the scheduled caller once:

```sql
select app_private.configure_message_auto_cleanup(
  'https://lvkeohpuucuklagvwpnq.supabase.co',
  '<SUPABASE_PUBLISHABLE_OR_LEGACY_ANON_KEY>'
);
```

The function stores the project URL, publishable key, and generated random invocation token in Supabase Vault. The worker runs every five minutes.

Do not call the configuration function until the Edge Function has been deployed. The migration intentionally does not point local test databases at production.

## Processing guarantees

- Message age is measured from `chat_messages.created_at` at 100 hours.
- Existing shorter disappearing-message expirations remain honored.
- Pinned messages and conversations marked `is_official` are excluded.
- Unreferenced `chat-media` objects are queued only after their own `storage.objects.created_at` exceeds 100 hours.
- Storage removal happens before database deletion.
- Failed Storage API requests return queue items to pending for retry.
- A successful Storage deletion is checkpointed before message rows are deleted.
- The worker processes at most 100 queue items per invocation and never issues SQL DELETE statements against `storage.objects`.
