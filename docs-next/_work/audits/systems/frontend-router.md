---
id: zero.inventory.frontend-router
type: inventory
audience: [agent, maintainer]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Frontend File Router And Navigation

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns file-route conventions, SSR/loaders/metadata, client navigation, route auth declarations and sitemap integration. Internal scanner/renderer exports are not automatically public package APIs.

## Features And Documentation Coverage

| Feature | Source-observed public contract/evidence | Canonical planned guide |
| --- | --- | --- |
| Pages/layouts/API routes/not found | RouteModule/RouteNode/MatchResult/LoaderContext/ApiHandler/PageMeta/RouterConfig/RouteConfig via frontend barrel; [src/frontend/router/types.ts](../../../../src/frontend/router/types.ts), [src/frontend/router/scanner.ts](../../../../src/frontend/router/scanner.ts) | `frontend/router/file-routes.md` |
| Dynamic/catch-all/group segments | App filesystem conventions; [src/frontend/router/route-tree.ts](../../../../src/frontend/router/route-tree.ts), [src/frontend/router/matcher.ts](../../../../src/frontend/router/matcher.ts) | `frontend/router/segments-and-groups.md` |
| Server loaders/parameter validation | loader/validate.params and LoaderContext access/auth/request/redirect; [src/frontend/router/renderer.ts](../../../../src/frontend/router/renderer.ts) | `frontend/router/loaders-and-validation.md` |
| Auth modes/inherited strengthening | RouteAuthMode/RouteAuthRequirement/EffectiveRouteAuthRequirement; isPublicPath/mergeRouteAuthRequirements/normalizeRouteAuthRequirement/resolveRouteAuthMode/shouldRequireAuthForRoute; [src/frontend/router/auth-policy.ts](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| Router state/context | RouterProvider/useParams/usePathname/useRouter; [src/frontend/client/router-context.tsx](../../../../src/frontend/client/router-context.tsx) | `frontend/router/provider-and-hooks.md` |
| Links/navigation/prefetch | Link/LinkProps/registerRoute/matchClientRoute/navigateTo/prefetchRoute; [src/frontend/client/link.tsx](../../../../src/frontend/client/link.tsx), [src/frontend/client/client-router.ts](../../../../src/frontend/client/client-router.ts) | `frontend/router/navigation.md` |
| SSR/client-only/generated manifest | createApp composition and public advanced startHydration; [src/frontend/server/client-bundle.ts](../../../../src/frontend/server/client-bundle.ts) | `frontend/router/rendering-and-hydration.md` |
| Route revalidation/cache | RouteConfig.revalidate; renderer-owned cache | `frontend/router/revalidation.md` |
| Sitemap | AppConfig sitemap/public routes/dynamic entries; [src/frontend/server/sitemap.ts](../../../../src/frontend/server/sitemap.ts) | `frontend/router/sitemap.md` |

## Public Surface And Integration Map

Root/react export Link and router hooks; RouterProvider is public there, but RouterProviderProps is source-local rather than assumed exported. useHasRouter, module-cache loaders, renderer invalidation, scanner/tree internals have no advertised package routes. See [support exports](../catalogs/frontend-support.md) and [package exports](../catalogs/package-exports.md).

Guardian supplies route authority and access facades. Parent layout requirements can strengthen child auth. Layout middleware protects page loading/rendering; API route modules declare their own middleware, not an assumed blanket layout shield. Hydration/cache must retain the server authorization boundary. RouterProvider owns browser history, not server responses. Sitemap visibility derives from server-owned publicness.

## Configuration Inventory

- RouteConfig.auth: shared access requirement; omission follows routeAuth/publicPaths/inheritance.
- RouteConfig.revalidate: seconds; 0 no cache; server render policy, not a browser freshness promise.
- RouteConfig.middleware: request/loader callback may short-circuit with Response; page/layout/API execution boundary matters.
- RouteModule.validate.params: Valibot parameter schema, server validation before loader/render.
- RouterProvider initialPathname/initialParams: SSR seeds; pathname fallback /; subscribed browser history.
- Link href/replace/prefetch/children/anchor props: `replace=false`, `prefetch='none'`; browser navigation. Modified/non-left/target/prevented clicks remain native; authorized dirty corrections also preserve download/non-local schemes and implement declared render/intent prefetch for normalized route pathnames. See closeout below.
- AppConfig appDir/outDir/publicPaths/routeAuth/loginPath/postLoginPath/sitemap: server startup/build/routing settings; detailed defaults owned by backend configuration inventory.

Planned `frontend/router/configuration.md`. Generated paths are not focused config discovery. No router config import or Doctor execution occurred.

## Evidence And Verification

Tests present: [src/frontend/router/scanner.test.ts](../../../../src/frontend/router/scanner.test.ts), [src/frontend/router/route-groups.test.ts](../../../../src/frontend/router/route-groups.test.ts), [src/frontend/router/auth-policy.test.ts](../../../../src/frontend/router/auth-policy.test.ts), [src/frontend/router/auth-navigation.test.ts](../../../../src/frontend/router/auth-navigation.test.ts), [src/frontend/router/renderer-validation.test.ts](../../../../src/frontend/router/renderer-validation.test.ts), [src/frontend/server/router-auth.integration.test.ts](../../../../src/frontend/server/router-auth.integration.test.ts), [src/frontend/server/router-isr-isolation.test.ts](../../../../src/frontend/server/router-isr-isolation.test.ts), [src/frontend/server/sitemap.test.ts](../../../../src/frontend/server/sitemap.test.ts). Example package-mode app; research [docs/frontend/router.md](../../../../docs/frontend/router.md).

## Findings, Philosophy, And Known Future Plans

- Verification gap: browser history/navigation/prefetch/SSR/cache not executed here.
- RouteValidation is declared in source but not directly named by the frontend barrel; avoid inventing its import.
- Established principle: file conventions compose pages while explicit server authority governs access. Router needs its own index/configuration/roadmap.
- Future Markdown-first docs/public-content tooling in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) builds on current routing, not a new hidden routing API.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 against route types/scanner/matcher, auth-policy compilation, Link/client-router/history provider, and renderer/hydration boundaries. Router and navigation catalog records now share the focused guide destinations above. Full structured `AccessRequirement` belongs to the server policy; the browser guard's reduced `false | required | admin` signal is presentation and must not be described as full permission enforcement. `config.auth: false` cannot weaken an inherited requirement. Layout middleware remains page-only; it does not implicitly run for a colocated API module.

Confirmed original-baseline Link contract gaps have been corrected in the authorized dirty working tree: declared `prefetch='render'` had no execution path, intent prefetch used raw query/hash strings and did not track changed hrefs, native `download` links were intercepted, and protocol-relative/non-HTTP URLs were misclassified as local history navigation. The focused correction uses normal URL parsing for same-origin HTTP(S) admission and normalized pathname prefetch keys; native target/download/external links are not prefetched or intercepted. Rendering remains SSR-safe because immediate prefetch occurs in an effect, not server render.

Synthetic browser reproduction in [link.browser.test.ts](../../../../src/frontend/client/link.browser.test.ts) failed **4 of 6 tests** before correction (2 passed). After the [Link fix](../../../../src/frontend/client/link.tsx), `bun --no-env-file test src/frontend/client/link.browser.test.ts` passed **6/6 with 27 assertions** on Bun 1.3.14. The in-memory bundle runs against routed synthetic HTML and traps native clicks after observing cancellation; no real app, provider, database or external-link navigation executes. This is focused dirty-checkout verification, not package qualification or complete router browser coverage.

The five auth-policy regressions passed as part of the [nine-file frontend reconciliation run](./frontend-sdk.md#independent-source-reconciliation). No browser navigation or package qualification was performed in that run.

## Navigation And Completion Review

The subsequent detailed runtime audit reproduced/fixed stale module navigation
and full-URL fallback loss. See [runtime lifecycle closeout](./frontend-runtime.md#supplemental-hydration-navigation-closeout)
for the original four failures, actual browser fixture, generation/unmount fences
and combined ten-case passing navigation run. This augments the earlier Link
closeout; neither invents a new route language or upgrades UI gating into server
authorization. The detailed [hydration guide](../../../frontend/runtime/hydration.md)
is the authoritative runtime home rather than duplicating its lifecycle here.

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.
