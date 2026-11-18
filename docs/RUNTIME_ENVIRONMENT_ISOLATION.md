# Runtime environment isolation

The browser application no longer embeds a Supabase project URL or publishable key in `index.html`.
Vercel serves `/api/runtime-config`, which exposes only the publishable client configuration needed by the browser.

## Required Vercel environment variables

Configure both variables in **Project Settings → Environment Variables**:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (the Supabase publishable/anon key only; never a service-role key)
- `SUPABASE_PREVIEW_ALLOWED_HOST` (Preview only; exact hostname such as `your-test-project.supabase.co`, without protocol or path)

Assign values by Vercel environment:

| Vercel environment | Supabase target |
| --- | --- |
| Production | The existing production project `lvkeohpuucuklagvwpnq` |
| Preview | A separate, disposable/test Supabase project; production host is explicitly rejected |
| Development | A local Supabase instance or a non-production test project |

Do not assign the production URL or key to Preview or Development. The runtime endpoint also rejects Supabase secret keys and legacy JWT keys carrying the service_role claim. Preview and Development deployments fail closed with HTTP 503 if variables are missing or if the production Supabase host is selected. Local HTTP endpoints and custom ports are accepted only in Development for localhost or 127.0.0.1.

Production deployments also fail closed unless the URL points to the approved production project. This prevents a configuration typo from silently redirecting live users to a test database.

## Safe rollout sequence

1. Before merging this change, add the existing production URL and publishable key to the Vercel **Production** environment variables. Do not paste either value into GitHub, source files, or chat.
2. Create or select a separate Supabase test project (do not use the store project). Apply the reviewed migrations to that test project only.
3. Add that project's URL, publishable key, and exact hostname in `SUPABASE_PREVIEW_ALLOWED_HOST` to Vercel **Preview** environment variables.
4. Redeploy Preview and verify `/api/runtime-config` reports a Preview configuration without revealing secrets; then run signup tests only with test invitations and test identities.
5. Merge only after Production variables and Preview isolation have both been verified.

The endpoint uses `Cache-Control: no-store`. Its response contains only the public browser key. It never returns service-role credentials. The service worker explicitly stores only a validated successful runtime-config response in an origin-scoped, versioned cache; it uses network-first behavior, falls back to that cached public configuration only when the network request fails, and never falls back to stale configuration after an HTTP error such as 503. This preserves cached-shell startup offline without caching authenticated API data or Supabase records.
