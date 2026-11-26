# index.html — Phase 1 audit record

- Scope: entry-point, bootstrap, startup/auth handoff, configuration and structural baseline.
- Source branch at audit: `main`.
- Source commit: `a9c97439b36c450da1fd042f88fd66bccf825e12`.
- Source blob: `a9c97439b36c450da1fd042f88fd66bccf825e12`.
- Snapshot size: 2,981 lines; 310,090 characters (text scan).
- Script tags: 17 opening tags in the text count; external script references were reviewed for order.
- Static IDs: 232; duplicate static IDs: none detected.
- Inline event-handler attributes: 0 detected.
- `innerHTML` assignment matches: 41; `insertAdjacentHTML` matches: 1. These are review targets, not automatically vulnerabilities.
- `index.html` currently depends on a global state object and a large inline script; Phase 1 does not extract feature code.

## Bootstrap contract reviewed

1. Early theme preference is applied before the app stylesheet to reduce theme flash.
2. Runtime configuration module is loaded before main app script and validates deployment target, Supabase host and public key.
3. Local test override is restricted to loopback endpoints and a configured expected port.
4. Supabase client is created after configuration validation.
5. Initial session retrieval and membership-state verification use bounded timeout wrappers.
6. App entry uses a promise lock and auth lifecycle version guards.
7. Initial session startup removes the boot overlay in a `finally` block.

## Observed risks and limits

- The large inline script remains a high-coupling entry point; ownership and dependency boundaries are not yet explicit.
- Static text scan cannot validate browser rendering, CDN availability, Supabase runtime behavior, focus/accessibility, or race conditions under real session transitions.
- The 41 `innerHTML` matches require context review in Phase 3; no blanket rewrite is recommended.
- No root `package.json` was present in the source snapshot. This Phase-1 guard uses Node's built-in modules and can be invoked directly.

## Score ledger

Score components (200 total) are evidence-weighted, not line-count based:

| Component | Before | Basis |
|---|---:|---|
| Entry document and boot UX contract | 30/35 | Boot screen, status, theme preflight present |
| Config/bootstrap ordering | 34/40 | Runtime config validated and ordered before client |
| Auth startup timeouts and handoff | 30/40 | Session/membership timeouts and lock present |
| Stale lifecycle protection | 20/30 | Lifecycle version guards observed |
| Repeatable baseline checks | 0/25 | No dedicated entry-contract audit runner in this scope before phase |
| Browser/runtime evidence | 8/30 | Source-only review; no browser smoke test verified |
| **Total** | **122/200** | **Baseline (before Phase 1 implementation)** |

Overall index.html program baseline: **610/1000 (provisional)**, computed as 122/200 scaled to the five-phase rubric. This is a program score, not a claim of measured application reliability.

## Phase 1 implementation plan

- Add a repeatable dependency-free entry-contract audit script.
- Keep it text-level and explicit about limitations.
- Avoid runtime behavior changes and avoid broad extraction.
- Run the audit in a Node-capable environment; record execution evidence separately. A source commit alone does not count as a test pass.
