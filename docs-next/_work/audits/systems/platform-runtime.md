---
id: zero.inventory.platform-runtime
type: inventory
audience: [maintainer, agent]
owner: platform-runtime
status: in-review
visibility: internal
system: platform-runtime
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# App Runtime And Backend Extensions Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Managed `createApp()` owns app-local services, startup, typed Elysia composition, request capability projection, and teardown. `ZeroAppRuntime` is an explicit owner, not an ambient current-app singleton. Low-level standalone plugin getters are compatibility surfaces and can become ambiguous with multiple apps.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

An **app runtime** is the app-local owner returned by `createApp()`. A **server
extension** is a declared endpoint, router, middleware, or plugin composed into
that runtime. **Setup services** are privileged capabilities supplied while a
trusted plugin is assembled; **request services** are projected only after a
request passes credential admission; **authority-scoped services** are the
strict, no-`unsafe` projection for an already verified machine/background
principal. These are separate authority boundaries, not interchangeable ways to
manufacture a browser session.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Planned canonical guide |
| --- | --- | --- | --- |
| App composition | `createApp`, `App`; Bun/Elysia managed server | `app-factory.ts`, `app-platform-mount.ts`: services and routing assembled after config/data admission | [Draft composition guide](../../../backend/runtime/composition.md) |
| Declarative HTTP endpoints | `defineEndpoint`, typed schemas/lifecycle `handler({ zero, access, user })` | `server-extensions.ts`: validation and auth before handler, not raw privileged services | [Draft endpoints guide](../../../backend/runtime/endpoints.md) |
| Routers and policy inheritance | `defineRouter`, `createServerRoute`, `ZeroRouterOptions`; nested prefix/auth | `server-extensions.ts`, `server-route.ts`, `server-policy.ts` | [Draft routers guide](../../../backend/runtime/routers.md) |
| Middleware matching | `defineMiddleware`, path/method/auth/role/property/predicate matchers | `server-matcher.ts`, middleware applicability and auth compilation | [Draft middleware guide](../../../backend/runtime/middleware.md) |
| Plugin setup | `defineZeroPlugin`, named Elysia plugin, lazy app-local setup services | `server-extensions.ts`, extension discovery/loader | [Draft plugins guide](../../../backend/runtime/plugins.md) |
| Module discovery | Configured plugin/middleware/endpoint/router/resource directories; arrays and raw Elysia/callback adapters | `server-route-loader.ts`, `resource-loader.ts`: trusted module execution | [Draft discovery guide](../../../backend/runtime/discovery.md) |
| Request services | `ServerRequestServices`, `zero.db`, `zero.databases`, domain facades, `zero.unsafe` | `create-request-services.ts`: deferred after credential admission; scoped commit/read fencing | [Draft server services guide](../../../backend/runtime/server-services.md) |
| Verified machine/background principals | `createAuthorityScopedServerServices`, options/result types; trusted server only | Requires caller-owned already validated scope and mandatory async/sync live fences; strict no unsafe projection | [Draft machine services guide](../../../backend/runtime/machine-services.md) |
| System/app separation | Privileged setup `zero.system`; app SQL handles; request unsafe boundary | `app-database-bootstrap.ts`, `server-services.ts` | [Draft data planes guide](../../../backend/runtime/data-planes.md) |
| Startup/failure cleanup | App-local service registrations; build, migrate, mount, initialize; rollback construction | `AppDatabaseBootstrap`, reverse cleanup ownership | [Draft lifecycle guide](../../../backend/runtime/lifecycle.md) |
| Graceful stop | Await extension drain hooks while Guardian/Fabric remain available, dispose owned services, transport handling | `app-stop-lifecycle.ts`, `app-signal-lifecycle.ts`; idempotent stop barrier | [Draft shutdown guide](../../../backend/runtime/shutdown.md) |
| Operational events | App-local observability sink injection and lifecycle event codes | `configureObservability`, `emitPlatformCodeTo`, `OBS_CODES.APP_LIFECYCLE_SLOW` | [Draft observability guide](../../../backend/runtime/observability.md) |

## Public Surface Map

- `@zero/framework/server` is the server-only entry point for `createApp`,
  `defineZeroConfig`, `resolveConfig`, configuration types, route policy helpers,
  and actor-backed database types.
- The same subpath exports `defineEndpoint`, `defineRouter`,
  `defineMiddleware`, `defineZeroPlugin`, `applyServerExtension`, extension
  composition helpers, and kind/type guards. Endpoints include typed transport
  schemas and Elysia lifecycle hooks; middleware matching covers path, method,
  auth, role, properties, and trusted predicates.
- `createServerRoute`, `createLazyServerRouteServices`, and
  `getServerRouteServices` expose admitted request projections. Plugin setup
  receives `ServerRouteServices`; request handlers receive
  `ServerRequestServices`.
- `createAuthorityScopedServerServices` is public for trusted machine/background
  code. Its synchronous and asynchronous live-authority fences are mandatory,
  and its result intentionally has no `unsafe` service bag.
- `ZeroAppRuntime` owns typed app-local registrations, reverse-order cleanup,
  and aggregate disposal failures. Ambient subsystem getters are compatibility
  surfaces, not the preferred multi-app composition contract.

## Configuration Inventory

`AppConfig`: discovery directories default to `./server/{plugins,middleware,endpoints,routes,resources}`, each supports `false` to disable; `appDir: './app'`, `outDir: './.build'`, `generatedDir: './.zero/generated'`, `port: 3000`. `auth` omission disables identity; workflows require auth. Domain settings have their own owners. `defineZeroConfig()` preserves literals and returns the same object; `resolveConfig()` resolves before app creation. Runtime settings aren't automatically editable in a database.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

1. Configuration admission and path isolation precede opening data planes.
2. System authority is opened/migrated before application data and physical tenant capabilities. Guardian references are readiness-gated.
3. Elysia validates transport, route access admits credentials; lazy request `zero` then reflects current authority. Tenant selection is server-derived, not request-supplied paths.
4. Domain services own business behavior; request proxies restrict access and revalidate at async results/commit boundaries.
5. Extension stop hooks drain first; runtime cleanups run reverse construction order and collect failures. Scoped services and explicit app-local observability prevent cross-app ambient confusion.

## Evidence And Verification

Implementation and public exports were inspected. The server runtime directory
contains 67 test files, including seven directly named for extension, route,
runtime, or stop behavior; those files were present but were not run in this
documentation pass.

- [src/frontend/server.ts](../../../../src/frontend/server.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/app-factory.ts](../../../../src/frontend/server/app-factory.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/server-extensions.ts](../../../../src/frontend/server/server-extensions.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/server-route-loader.ts](../../../../src/frontend/server/server-route-loader.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/server-request-services/create-request-services.ts](../../../../src/frontend/server/server-request-services/create-request-services.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/app-extension-shutdown.integration.test.ts](../../../../src/frontend/server/app-extension-shutdown.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/app-runtime-isolation.integration.test.ts](../../../../src/frontend/server/app-runtime-isolation.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/runtime/zero-app-runtime.ts](../../../../src/runtime/zero-app-runtime.ts): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Public service projection is a trusted-code boundary, not an API to fabricate sessions. Raw Elysia plugins/unsafe handles retain the application's enforcement responsibility. The new guide must classify setup versus request versus workflow execution services separately. No runtime defect is concluded from this source inventory.

## Known Future Plans

Known user proposals: explicit headless/server-only scaffolding and improved plugin authoring ergonomics; planned, not new configuration switches supplied by this documentation pass.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/runtime/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [x] Whole-platform discovery/ownership reconciliation complete (not package/security qualification).
- [ ] Important examples and artifact/package support qualified.
- [x] Detailed draft guide homes replace the feature table's planned paths; independent manual/artifact qualification pending.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
