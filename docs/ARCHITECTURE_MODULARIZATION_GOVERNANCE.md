# Architecture Modularization Governance

**Baseline:** main at `2d94ec86ea1c7c6746f20d2dc8ee20b5fa3e1093`  
**Scope:** frontend architecture, boundaries, module contracts and migration discipline.  
**Safety:** behavior-preserving extraction only. No production/main direct changes, database changes, permission changes or UI redesign as part of structural extraction.

## Verified architecture observations

- The application remains a static SPA with a large inline controller in `index.html`.
- Eleven feature/infrastructure JavaScript modules are present under `modules/`.
- Seven module CSS files are linked from the shell.
- Several extracted modules still rely on shared globals, DOM ids, callbacks and/or state owned by the main controller. File separation alone does not establish independent modules.
- Membership administration is separately loaded but still relies on controller-owned globals and DOM contracts.
- The service worker manually maintains a shell cache list, which must be kept synchronized with new assets.
- Existing `docs/ARCHITECTURE_DEPENDENCY_MAP.md` is a discovery map; it is not an AST-generated dependency graph and should not be treated as a fully verified call graph.

## Architecture acceptance criteria

1. Every module declares a narrow public API and explicit dependencies.
2. Module initialization is idempotent and has an explicit teardown/disposal path for listeners, channels, timers, observers and media resources where applicable.
3. Feature modules do not directly mutate another feature's internal state. State ownership and mutation interfaces must be documented.
4. Infrastructure (Supabase, configuration, logging, event dispatch, DOM helpers) is accessed through owned adapters or explicit injected contracts, not implicit global discovery.
5. No cyclic feature-module dependency; feature orchestration belongs to the composition/bootstrap layer.
6. DOM ownership is explicit. Feature-owned DOM regions must not be manipulated by unrelated modules.
7. Static assets and module scripts must be registered in the application shell and service-worker cache where applicable.
8. Extraction PRs must preserve behavior and include regression tests; changes to feature behavior, DB or permissions are separate PRs.
9. Every boundary change must include an updated dependency map and test evidence.
10. CI must enforce the shell/offline asset contract, duplicate-id contract, and absence of inline HTML event-handler attributes.

## Target layering

- **Bootstrap / composition:** wires modules, dependencies, startup and teardown; no feature-specific persistence or UI rendering.
- **Core adapters:** configuration, Supabase access, diagnostics/logging, storage, event bus and lifecycle helpers.
- **State owners:** isolated state domains with defined APIs and mutation rules.
- **Feature modules:** conversations, message lifecycle/rendering, directory/presence, channels/groups, notifications, workspace, membership, media and backup.
- **UI primitives:** dialog, toast, menu, formatting, escaping and accessibility helpers with minimal feature knowledge.

Features should not import or invoke other feature internals directly. Cross-feature workflows are orchestrated by bootstrap/application services or published events.

## Extraction order (risk-weighted)

1. **Governance and asset contracts:** static checks and updated dependency map.
2. **Shared helpers and diagnostics:** establish contracts without changing behavior.
3. **Directory and presence:** comparatively bounded, but preserve realtime lifecycle.
4. **Notifications and personal preferences:** define ownership and subscriptions.
5. **Membership admin:** remove implicit global coupling through explicit initialization contract.
6. **Workspace and status:** isolate persistence and rendering.
7. **Group/channel administration:** extract after common conversation contracts exist.
8. **Conversation list/direct chat:** high-coupling; extract only after state ownership.
9. **Composer and attachment pipeline:** isolate async/lifecycle concerns.
10. **Message renderer and lifecycle:** last, with strict regression coverage.
11. **Realtime orchestration:** extract after feature subscription ownership and teardown contracts are defined.

## Prohibited shortcuts

- Bulk moving functions based only on names or line ranges.
- Creating facade files that merely re-export the same globals without reducing coupling.
- Rewriting the application in a new framework during this migration.
- Concurrent feature, schema, security-policy and architecture changes in one extraction.
- Editing main directly or merging without green checks and reviewed diff.
- Declaring architecture 100/100 based solely on file count or passing static checks.

## Baseline risk register

| Risk | Level | Evidence / impact | Closure evidence |
|---|---|---|---|
| Main controller remains broad | Critical | Large inline script, shared mutable state, direct DOM wiring | Incremental extraction, ownership interfaces, regression tests |
| Implicit module contracts | High | Extracted modules and membership code use shared controller context | explicit dependency contracts and initialization APIs |
| Subscription/timer lifecycle | High | Realtime, polling and media lifecycle span features | owned teardown, repeated open/close tests |
| Asset-cache drift | High | Shell and worker maintain manually synchronized lists | CI shell/cache asset contract |
| Feature cross-coupling | High | Dependency map identifies broad shared state and direct call patterns | dependency graph and no-cycle check |
| Architecture map drift | Medium | Map is manual and snapshot-oriented | generated inventory or regular verified refresh |

## Scoring discipline

100/100 for architecture is an aspirational target, not an immediate label. A score requires evidence that the boundaries are enforced, coupling reduced, module lifecycle covered, dependency graph verified, and extraction regression tests passed across the full application. Static governance is the first closure step, not the finish line.
