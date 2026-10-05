---
id: zero.inventory.frontend-runtime
type: inventory
audience: [agent, maintainer]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Frontend Runtime, Providers, And Hydration

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns browser/SSR provider composition, generated hydration entry, scope-aware presentation, and render-error boundaries. SDK transport and router semantics have separate inventories; backend authority remains in Guardian and Resources/Sync. A browser client is not a second backend authority store.

## Features And Documentation Coverage

These are implemented public source/local surfaces; the [component](../catalogs/frontend-components.md) and [hook](../catalogs/frontend-hooks.md) catalogs individually enumerate their symbols/routes. Mode-specific behavior is not qualified here.

| Feature | Public surfaces and source evidence | Canonical planned guide |
| --- | --- | --- |
| Root provider and SSR fallback | AppProvider/AppProviderProps; [src/frontend/client/app-provider.tsx](../../../../src/frontend/client/app-provider.tsx), [src/frontend/client/app-provider-sync-config.ts](../../../../src/frontend/client/app-provider-sync-config.ts) | `frontend/runtime/app-provider.md` |
| Required/nullable client access | ClientProvider/ClientProviderProps, useClient/useClientMaybe/useIsServer/shouldUseSsrFallback; [src/frontend/client/client-context.tsx](../../../../src/frontend/client/client-context.tsx) | `frontend/runtime/client-provider.md` |
| Hydration manifest | startHydration/HydrationManifest/HydrationManifestEntry via /react/hydrate-runtime; [src/frontend/client/hydrate-runtime.tsx](../../../../src/frontend/client/hydrate-runtime.tsx) | `frontend/runtime/hydration.md` |
| Scope fences/stale callbacks | useAuthorizationScopeBoundary/isAuthorizationScopeCallbackCurrent/AuthorizationScopeBoundary; [src/frontend/client/authorization-scope-hooks.ts](../../../../src/frontend/client/authorization-scope-hooks.ts) | `frontend/runtime/authorization-scope-boundary.md` |
| Identity/tenant replacement display | Internal scope controllers; [src/frontend/client/authorization-scope-display.ts](../../../../src/frontend/client/authorization-scope-display.ts), [src/frontend/client/authorization-data-boundary.ts](../../../../src/frontend/client/authorization-data-boundary.ts) | `frontend/runtime/scope-transitions.md` |
| Render errors/not found | ErrorBoundary/NotFoundPage; [src/frontend/client/error-boundary.tsx](../../../../src/frontend/client/error-boundary.tsx) | `frontend/runtime/error-boundaries.md` |
| Optional notification/toast provider | NotificationProvider/NotificationProviderProps/useNotificationContext; [src/frontend/client/notification-provider.tsx](../../../../src/frontend/client/notification-provider.tsx) | `frontend/notifications/components.md` |
| Low-level Sync provider integration | SyncProvider/SyncProviderProps/useSyncClient via /sync/client; [src/sync/client/hooks.ts](../../../../src/sync/client/hooks.ts) | `frontend/runtime/sync-provider.md` |

## Public Surface And Integration Map

Root and /react alias the frontend barrel. AppProvider and hooks have /react/app-provider and /react/hooks alternatives. SSR composes RouterProvider and ErrorBoundary without opening a transport; hydration attaches ClientProvider, SyncProvider and ModalManager to the same SDK. NotificationProvider and ThemeProvider are optional, not automatically installed merely because they are public. RouterProvider semantics are inventoried separately.

Server-injected platform/route metadata is compared at the browser authorization boundary. Guardian and Resources/Sync enforce permissions server-side; resetting UI cannot grant access. SDK scope changes invalidate cached results and modals. InternalClient transport fields and generated window payloads are integration internals, not caller-owned authority.

## Configuration Inventory

| Exact settings | Resolution/timing/default/exposure |
| --- | --- |
| AppProvider url/tables | Required props; tables accept raw client definitions/schema clientTable. Browser normalization at composition; SSR does not create a transport. |
| auth/stateSync | Explicit props, then injected server booleans, then false. State Sync requires auth; contradictory explicit enables reject. Public booleans, not secrets. |
| publicPaths/routeAuth/loginPath/postLoginPath | Explicit props then injected values, then defaults: six account paths (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/setup-password`, `/verify-email`), protected-by-default, `/login`, `/`. Path normalization rejects unsafe paths and a configured login/post-login loop. Server policy remains authoritative. |
| initialPathname/initialParams/errorFallback/children | SSR seeds/render customization; React props, not environment discovery. |
| NotificationProvider autoToast/toastDuration/renderToast | Runtime defaults true/5000 ms/omitted renderer; null custom render suppresses toast; client context required. |
| Generated tableSyncModes/tableSyncPlanes/managedTableNames | Server-owned browser routing metadata consumed at hydration; never client-selected authority. |

Planned `frontend/runtime/configuration.md`. Doctor server config/usage checks do not exercise React props, hydration, accessibility, or arbitrary provider reconfiguration.

## Evidence And Verification

Tests present: [src/frontend/client/authorization-scope-hooks.test.ts](../../../../src/frontend/client/authorization-scope-hooks.test.ts), [src/frontend/client/authorization-scope-hooks.browser.test.ts](../../../../src/frontend/client/authorization-scope-hooks.browser.test.ts), [src/frontend/client/data-realm-readiness-hooks.test.ts](../../../../src/frontend/client/data-realm-readiness-hooks.test.ts), [src/frontend/server/client-bundle.test.ts](../../../../src/frontend/server/client-bundle.test.ts), [src/frontend/server/package-mode-fixture.test.ts](../../../../src/frontend/server/package-mode-fixture.test.ts), [src/package-distribution.test.ts](../../../../src/package-distribution.test.ts). Example [examples/package-mode/app/layout.tsx](../../../../examples/package-mode/app/layout.tsx); [docs/frontend/sdk.md](../../../../docs/frontend/sdk.md) and [docs/frontend/router.md](../../../../docs/frontend/router.md) are research inputs.

## Findings, Philosophy, And Known Future Plans

- Verification gap: no production browser/provider mode matrix was executed.
- Source contract: createClient enforces one active browser singleton. Recipes must not imply general concurrent independent clients.
- Production error presentation depends jointly on error-boundary.tsx and client-bundle.ts NODE_ENV replacement; qualify bundled output before promising no details/stack exposure.
- Established principle: providers compose existing transport and UI layers; scope display is not authorization. Onboarding/catalog improvements in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) remain planned.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 against provider/context/hydration implementations, the public frontend and low-level Sync barrels, and authorization scope/readiness/display controllers. The component/hook/support catalogs now share this inventory's runtime guide destinations instead of assigning the same provider to a second SDK home. This is targeted inventory reconciliation, not closure of the whole-platform or publication gates.

AppProvider's SSR branch does not create a client; ClientProvider itself accepts a supplied client or creates/reuses the singleton from `config` and is not the same SSR orchestration boundary. Initial client ownership is retained in a ref: later changes to provider props do not constitute supported server configuration updates or a fresh independent client. `useClient()` returns a runtime null on SSR without a provider despite its required-client TypeScript return type; `useClientMaybe()` states that nullable shape explicitly. `shouldUseSsrFallback` is available from `/react/hooks`, not the root named export. Generated hydration requires app-owned manifest modules and route payload; missing root/payload/entry emits a frontend code and does not fabricate a page.

The isolated SDK configuration/anonymous-reset tests passed in the [nine-file frontend reconciliation run](./frontend-sdk.md#independent-source-reconciliation). That run is dirty-working-tree evidence; production hydration, actual browser rendering and packaged output remain unqualified.

## Navigation And Completion Review

### Supplemental Hydration Navigation Closeout

Detailed runtime writing traced and then reproduced a route-module lifecycle
defect in the actual public startHydration runtime. In the original dirty source,
a delayed older module replaced a newer Page/params/auth requirement, a stale
missing module redirected the newer URL, a missing module finishing after
unmount still redirected, and server fallback discarded query/hash. The final
synthetic browser reproduction recorded **0 passed, 4 failed** before correction
(an earlier harness synchronization issue was corrected before that evidence run).

The minimal correction adds current-generation/active/current-path checks before
state commit, redirect and failure-state cleanup. Full server/current-missing
fallback reloads the complete committed local URL; no new route feature or auth
permission was added. Actual React root creation is preserved in the test; a
fixture-only wrapper exposes root unmount. Routes/modules/HTML are synthetic,
the bundle is built in memory, and no app/server/provider/live data was used.

`bun --no-env-file test src/frontend/client/hydrate-runtime.browser.test.ts src/frontend/client/link.browser.test.ts`
passed **10 tests, 0 failed, 36 assertions** (four hydration and six Link cases).
See [hydration source](../../../../src/frontend/client/hydrate-runtime.tsx),
[browser test](../../../../src/frontend/client/hydrate-runtime.browser.test.ts)
and [actual runtime fixture](../../../../src/frontend/client/hydrate-runtime.browser-fixture.tsx).
This is pending dirty-source evidence, not clean-artifact qualification.

An independent reviewer subsequently checked the exact generation/active/path
and queued-transition fences, reran both actual browser files with the same
**10 passed / 0 failed / 36 assertions**, and reported current global typecheck
passing after a separate concurrent AI test-only readonly correction. No runtime
exports or authority shortcut was introduced.

The [runtime entrance](../../../frontend/runtime/index.md) and configuration,
AppProvider, ClientProvider, low-level Sync, scope boundary/transitions,
hydration, error and roadmap draft homes now exist with real navigation.
Remaining frontend systems/component coverage and artifact/examples still need
their own qualification. The support catalog now correctly points startHydration
to runtime/hydration rather than inventing a second SDK hydration home.

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.
