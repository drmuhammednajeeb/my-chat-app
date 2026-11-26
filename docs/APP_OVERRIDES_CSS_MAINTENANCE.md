# app-overrides.css maintenance

- Keep this file as a narrow, late-cascade compatibility layer; new features should prefer their owning stylesheet or module stylesheet.
- Before adding a rule, search the base stylesheet, theme tokens, module CSS, and this file for an existing rule to extend.
- Avoid repeated override blocks and duplicate media-query resets. Preserve cascade order when consolidating; do not reorder broad theme or component rules without visual regression evidence.
- Make each cleanup incremental and run the Node regression suite plus browser checks where available.
- Cleanup record (2026-11-26): removed one exact duplicate reduced-motion reset, two identical menu hover declarations, and overlapping theme hover/selected rules plus a repeated heading color selector. This intentionally does not restructure the file wholesale because many selectors are cascade-sensitive.
