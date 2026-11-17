# Message Auto-Cleanup Edge Function

This worker removes eligible message media through the Supabase Storage API before deleting message rows.

## Deployment

Deploy this function with JWT verification disabled. The function itself authenticates the caller through Supabase's server-side secret-key mode and an additional per-project Vault token:

```sh
supabase functions deploy message-auto-cleanup --no-verify-jwt
```

The Edge Function uses `@supabase/server` with `auth: "secret"` and `ctx.supabaseAdmin`. The caller must send the project's default `sb_secret_...` key in the `apikey` header only; do not send it in `Authorization: Bearer`. The function also verifies `x-auto-cleanup-token` against the random token stored in Vault.

Never expose the secret key or Vault token to the browser or commit them to the repository.

## Activation order

1. In Supabase Settings → API Keys, confirm the project's default Secret API key (`sb_secret_...`) exists.
2. In Database → Vault, create a secret named `message_cleanup_backend_key` and paste the default Secret API key as its value. Do not put the key in SQL text, source files, or chat.
3. Deploy the Edge Function using the command above.
4. Apply the reviewed database migration.
5. As the database owner, configure the scheduled caller once:

```sql
select app_private.configure_message_auto_cleanup(
  'https://lvkeohpuucuklagvwpnq.supabase.co'
);
```

The function reads the backend key from Vault, stores the project URL and generated random invocation token in Vault, and schedules the worker every five minutes. The key is sent only in the `apikey` header.

The migration intentionally does not point local test databases at production.

## Processing guarantees

- Message age is measured from `chat_messages.created_at` at 100 hours.
- Existing shorter disappearing-message expirations remain honored.
- Pinned messages and conversations marked `is_official` are excluded.
- Unreferenced `chat-media` objects are queued only after their own `storage.objects.created_at` exceeds 100 hours.
- Storage removal happens before database deletion.
- Failed Storage API requests return queue items to pending for retry.
- A successful Storage deletion is checkpointed before message rows are deleted.
- The worker processes at most 100 queue items per invocation and never issues SQL DELETE statements against `storage.objects`.
