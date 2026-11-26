# Auth Session Lifecycle — Stage 5

## Scope
Extracts the concurrency and invalidation coordinator for application entry from `index.html` into `modules/auth-session.js`.

The module owns:
- A monotonically increasing lifecycle generation.
- Deduplication of concurrent app-entry requests for the same user.
- Serialization when an app-entry request arrives for a different user.
- Explicit invalidation on `SIGNED_OUT`.
- A stable `isCurrent(version)` guard for asynchronous auth hydration.

## Deliberate boundaries
Membership verification, email confirmation, profile creation, Supabase Auth calls, UI transitions, channel cleanup, and application data hydration remain in the existing application auth flow. The extracted module does not access Supabase, the DOM, or browser storage.

## Compatibility
`enterApp(user)` remains as the existing entry point and delegates to the extracted coordinator. Existing stale-operation checks now call `authSessionLifecycle.isCurrent()`; the signed-out handler calls `invalidate()`.

## Validation
Run `node tests/auth-session.test.js`. CI verifies script ordering, removal of the old global lifecycle variables, and use of invalidation/staleness guards. Real browser tests for login, refresh, account switching, and sign-out remain required before merge.
