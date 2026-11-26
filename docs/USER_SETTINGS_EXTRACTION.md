# User Settings Controller — Stage 4

## Extracted responsibilities
- Load the authenticated user's `user_settings.settings` JSON object.
- Reject stale load/save completions when the authenticated user changes during an asynchronous request.
- Persist one setting through the existing `patch_my_user_settings` RPC.
- Keep the existing in-memory `state.userSettings` contract.
- Notify the app theme controller when a valid account theme preference is loaded.

## Deliberate boundaries
- No schema or SQL changes; existing table and RPC remain the persistence contract.
- No auth/session ownership moved; the module receives state and Supabase client through injected getters.
- No UI, account permissions, or RLS behavior changed.
- `index.html` retains compatibility wrappers for existing call sites.
- Theme rendering and device-local theme persistence remain in `modules/app-theme.js`.

## Validation
Run `node tests/user-settings.test.js`. GitHub Actions also verifies module ordering and compatibility wrappers. Browser-level account switching and settings persistence checks remain required before merge.
