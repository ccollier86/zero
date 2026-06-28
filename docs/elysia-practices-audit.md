# Elysia Practices Audit

This file records how Zero should apply Elysia best practices while hardening the backend. Use it with `docs/platform-hardening-plan.md` and `docs/engineering-standards.md`.

## 1. Principles To Preserve

### 1.1 Feature Modules

Elysia recommends feature-based modules where each feature owns its controller, service, and model/types.

Zero already follows this shape:

1. `src/auth/*`
2. `src/sync/*`
3. `src/rooms/*`
4. `src/notifications/*`
5. `src/workflows/*`
6. `src/scheduler/*`
7. `src/storage/*`

Current verdict: good. Preserve this structure.

### 1.2 Elysia Instance As Controller

Elysia recommends treating one `Elysia` instance as one controller and letting route handlers infer context types naturally.

Zero mostly follows this:

1. `createAuthPlugin()`
2. `createSyncPlugin()`
3. `createRoomPlugin()`
4. `createNotificationPlugin()`
5. `createWorkflowPlugin()`
6. `createSchedulerPlugin()`
7. `createStoragePlugin()`
8. `createDataQueryPlugin()`

Current verdict: good. Do not introduce controller classes that accept `Context`.

### 1.3 Do Not Pass Whole Elysia Context To Services

Elysia warns against typing and passing the entire `Context` object into controllers/services.

Zero mostly follows this. Services are framework-decoupled and receive concrete inputs:

1. `RoomService`
2. `NotificationService`
3. `WorkflowService`
4. `SchedulerService`
5. `StorageService`
6. `UserStore`
7. `TokenService`

Current verdict: good. Keep services independent of Elysia context.

### 1.4 Use Elysia Validation As Runtime DTOs

Elysia recommends `t.Object`, `t.String`, `t.Numeric`, etc. as the source of truth for route validation and type inference.

Zero uses inline Elysia validation heavily in route plugins.

Current verdict: mostly good. Opportunities:

1. Extract repeated schemas into module-level `Model` objects where it improves readability.
2. Consider `.model()` references for large plugins if TypeScript performance becomes an issue.
3. Add `response` validation selectively for public/stable API routes where return contracts matter.

### 1.5 Explicit Plugin Dependencies

Elysia requires plugins that need typed services, models, macros, or context to explicitly `.use()` the dependency.

This is the key practice that explains current issues.

Current state:

1. `auth.middleware.ts` correctly exports `authContext`, `requireAuth`, and `requireAdmin` from a global resolve lifecycle.
2. `notifications`, `rooms`, `scheduler`, and `workflows` explicitly use auth middleware inside their plugins.
3. Done in hardening item 7.5: `storage` now declares auth middleware inside the plugin that consumes `authContext` and `requireAuth`.
4. `app-factory.ts` still mounts auth middleware before storage for parent routes, but storage no longer relies on parent plugin order for its isolated route types.

Current verdict: storage now follows the explicit dependency rule.

### 1.6 Named Plugins And Deduplication

Elysia recommends naming plugins so repeated `.use()` calls deduplicate lifecycle and types.

Zero names most backend plugins:

1. `sync`
2. `auth`
3. `auth-middleware`
4. `notifications`
5. `rooms`
6. `scheduler`
7. `workflows`
8. `storage`
9. `data-query`
10. `router`

Current verdict: good. Keep all reusable plugins named.

### 1.7 Lifecycle Scope Matters

Elysia lifecycle hooks are isolated by default. Use `as: 'global'`, `as: 'scoped'`, or instance `.as()` intentionally.

Current state:

1. Auth middleware uses `resolve({ as: 'global' })` for `authContext`.
2. Auth middleware also returns `requireAuth` and `requireAdmin` from `resolve` because those helpers depend on async token verification for the current request.
3. Sync plugin uses `derive({ as: 'global' })` for `syncDB`.
4. Notifications, rooms, and scheduler expose services with `derive({ as: 'global' })`.
5. Workflows exposes service/registry with `derive({ as: 'scoped' })`.

Current verdict: mixed. Auth helpers and `syncDB` reasonably need global reach. Domain service derivation should be reviewed; most business services are better as explicit dependencies or module getters unless every later route needs them.

### 1.8 Avoid Functional Callback Plugins Unless Needed

Elysia recommends returning a new `Elysia` instance rather than using functional callback plugins, unless direct access to the parent instance is required.

Zero mostly returns new `Elysia` instances.

Current verdict: good.

### 1.9 Use `handle()` In Tests

Elysia recommends testing controllers by calling `app.handle(new Request(...))`, which exercises lifecycle and validation.

Zero already does this in auth tests and should use it more for route plugins.

Current verdict: good direction. Add more `handle()` tests around storage, data-query, scheduler, rooms, notifications, and workflows.

## 2. Backend Module Audit

### 2.1 Sync Plugin

Strengths:

1. Named plugin.
2. Owns lifecycle for ReactiveDB.
3. WebSocket route lives in the plugin controller.
4. Does not pass Elysia context into services.

Problems:

1. Done in hardening item 7.1: WS auth now uses an explicit token verifier injected through sync config.
2. Done in hardening item 7.1: `ws.data.authContext` is populated during the WS `open` lifecycle.
3. Done in hardening item 7.2: sync read/write policy now lives in sync config and `src/sync/sync-policy.ts`.

Action:

1. Keep future sync authorization changes behind `SyncPolicy` callbacks rather than Elysia route casts.
2. Keep WebSocket token verification delegated to auth through the narrow verifier contract.
3. Add WebSocket integration tests for every sync auth or policy change.

### 2.2 Auth Plugin And Middleware

Strengths:

1. Good separation between auth routes, middleware, user store, and token service.
2. Auth middleware uses `resolve({ as: 'global' })`, which is the right Elysia tool for typed request-dependent auth context.
3. `requireAuth()` and `requireAdmin()` are request-dependent helpers returned from the same resolve lifecycle, so they close over the verified auth context for that request.

Problems:

1. HTTP auth middleware does not automatically apply to WebSocket token verification.
2. `getTokenService()` is module-level state, which works for the platform but should be documented as single-app-per-process.

Action:

1. Reuse `TokenService.verifyAccessToken()` for WebSocket auth.
2. Keep HTTP auth middleware as the request path source of truth.
3. Add a small WS auth helper instead of trying to force HTTP context into WS lifecycle.

### 2.3 Storage Plugin

Strengths:

1. Feature module exists.
2. Storage business logic is decoupled into `StorageService`.
3. Routes use Elysia validation.

Problems:

1. Done in hardening item 7.5: the plugin now declares `.use(createAuthMiddleware(getTokenService))`.
2. Done in hardening item 7.5: route tests cover unauthenticated writes, owner reads, public reads, forbidden updates, and admin updates.
3. Done in hardening item 8.1: storage client hooks now use SDK auth and token refresh instead of direct browser token reads.

Action:

1. Keep the explicit `.use()` pattern already used by notifications/rooms/scheduler/workflows.
2. Keep storage hooks on SDK auth transport for future storage UI/API work.
3. Add upload/presigned route coverage when storage API work continues.

### 2.4 Notifications, Rooms, Scheduler, Workflows

Strengths:

1. They use named Elysia instances as controllers.
2. They explicitly `.use(createAuthMiddleware(getTokenService))`.
3. They use service classes for business logic.
4. They use `t` validation.

Problems:

1. Repeated auth middleware use is okay because plugin is named, but the pattern should be documented as intentional Elysia deduplication.
2. Some service derives are global where scoped or explicit dependencies may be more appropriate.
3. Some schemas are inline and could be extracted if plugin files grow too large.

Action:

1. Keep explicit `.use()` auth dependency in each auth-aware plugin.
2. Review global derives after security work.
3. Add response schemas selectively for admin APIs and public SDK APIs.

### 2.5 Data Query Plugin

Strengths:

1. Named plugin.
2. Route validation exists.
3. SQL identifier validation is present.
4. Values use parameterized query params.

Problems:

1. It currently gets DB via global module getter rather than explicit plugin dependency.
2. Done: `/api/data` now integrates sync read policy and HTTP auth context.
3. Done: query validation now covers pagination, sort direction, and explicit filter operators.

Action:

1. Consider passing `db` directly through config instead of using `getSyncDB()`.
2. Keep `/api/data` on the same sync read policy used by WebSocket subscriptions.
3. Add index-focused diagnostics only if real apps show slow lazy-table queries.

## 3. Elysia-Specific Fix Rules

Use these rules when implementing backend fixes:

1. Do not type route handlers with `Context`.
2. Do not pass whole route context into services.
3. Add dependencies with `.use()` inside the plugin that consumes them.
4. Name every reusable plugin.
5. Use `resolve` for request-dependent values that may be async, such as `authContext`.
6. Use `derive` for helper functions or values that are derived from resolved context.
7. Use `as: 'global'` only for values intentionally exported to parent and later plugins.
8. Keep business logic in service classes/functions, not route handlers.
9. Keep validation close to routes or in module-level model objects.
10. Add `handle()` tests for routes so validation and lifecycle run.
11. Prefer Elysia type inference over casts.
12. A type error around missing route context usually means a plugin dependency is missing.

## 4. Immediate Impact On The Hardening Plan

The Elysia best-practice lens changes the first backend fixes slightly:

1. Done in hardening item 7.5: storage type errors were fixed by declaring the missing auth dependency, not by casting.
2. Do not bolt WebSocket auth onto random route context. Add an explicit WS token verification path.
3. Do not rely on app-factory plugin order alone for types. Each plugin that consumes auth helpers should declare auth middleware.
4. Keep sync policy as plugin config/service logic, not as scattered route code.
5. Add route tests with `app.handle()` when changing HTTP plugins, and WebSocket integration tests when changing sync.
