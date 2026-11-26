# app-overrides.css maintenance

- Keep this file as a narrow, late-cascade compatibility layer; new features should prefer their owning stylesheet or module stylesheet.
- Before adding a rule, search the base stylesheet, theme tokens, module CSS, and this file for an existing rule to extend.
- Avoid repeated override blocks and duplicate media-query resets. Preserve cascade order when consolidating; do not reorder broad theme or component rules without visual regression evidence.
- Make each cleanup incremental and run the Node regression suite plus browser checks where available.
- The November 2026 cleanup removed one exact duplicate reduced-motion reset. It intentionally does not restructure the file wholesale because several rules are cascade-sensitive.
