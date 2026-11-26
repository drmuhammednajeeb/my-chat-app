# App Theme Controller — Stage 3

## Scope
Extracts the global application theme lifecycle from `index.html` into:
- `modules/theme-boot.js`: synchronous pre-paint theme selection (local preference + OS preference), loaded before application styles.
- `modules/app-theme.js`: global theme application, preference persistence, toggle handling, OS theme changes, cross-tab storage synchronization, and button accessibility state.

Conversation-specific themes and group accent themes remain in the main controller; they are separate preference domains and are intentionally not changed.

## Integration contract
- The classic script publishes `window.BizmindAppTheme.create()`.
- The main inline controller supplies only existing integration callbacks (`saveUserSetting`, `toast`, and logger).
- Account settings are applied through `appThemeController.setPreference()`.
- The pre-paint boot script preserves `window.__BIZMIND_THEME_PREFERENCE__` for initialization.
- No Supabase calls, database schema changes, or auth lifecycle changes were moved into the module.

## Validation
`tests/app-theme.test.js` covers stored dark preference, system preference, explicit light selection, storage persistence/removal, toggle, and cross-tab storage updates.
GitHub Actions additionally checks script ordering and the account-settings integration.
Browser-level visual smoke testing is still required before merge.
