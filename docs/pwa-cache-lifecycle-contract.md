# PWA Cache Lifecycle Contract

## Scope

This contract protects the service-worker lifecycle and offline application shell without changing authentication, API, database, or user-data behavior.

## Cache ownership and versioning

- Cache names are isolated under the `ultra-chat-pro-` namespace.
- Shell and approved static-CDN caches use the same explicit release version.
- A release increments the cache version when shell behavior or cached assets change.
- Activation deletes obsolete caches owned by this application only; unrelated origin caches are preserved.

## Install and offline navigation

- Installation precaches the scope root and an explicit `index.html` document.
- The HTML dependency inventory remains enforced by the architecture safety test.
- Navigation is network-first and falls back to the cached document, then the cached scope root.
- A readable 503 response is returned only when neither network nor offline shell is available.

## Data isolation

- Only GET requests are eligible for handling.
- Only the same-origin application shell allowlist and the explicitly approved static CDN origins are cacheable.
- Supabase, authenticated API responses, messages, uploads, and user-specific data must never enter Cache Storage.
- `deployment-config.js` is always fetched with `no-store` and is never precached.

## Update lifecycle

- The worker does not unconditionally call `skipWaiting` during installation.
- Activation is requested only through the explicit `SKIP_WAITING` message.
- `clients.claim()` occurs after obsolete application-owned caches are removed.

## Verification

Run:

```sh
node --test tests/service-worker-lifecycle.test.mjs tests/architecture-safety-contract.test.mjs
```

The dedicated GitHub Actions workflow runs these checks on pull requests and pushes to `main`.
