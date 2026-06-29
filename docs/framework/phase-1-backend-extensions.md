# Phase 1: Backend Extensions

Status: implemented

This phase makes app-owned backend code a first-class Zero framework surface.
The current package-mode loader already accepts raw Elysia plugins from
`server/routes`; Phase 1 adds Zero-native declarations that compile to Elysia
internally.

Raw Elysia remains supported as an escape hatch, but generated examples and docs
should prefer Zero declarations.

## Goals

1. Let apps register API endpoints without writing Elysia chaining for common
   use cases.
2. Let apps group endpoints into routers.
3. Let apps register middleware in a controlled, named way.
4. Let apps register plugins with access to Zero services and the underlying
   Elysia instance.
5. Load app-owned extensions from predictable folders.
6. Preserve existing `server/routes` raw Elysia behavior.

## Non-Goals

These are planned for later phases:

1. Full metadata-aware middleware matchers.
2. Resource CRUD generation.
3. Typed frontend action transport.
4. Doctor checks for every framework convention.
5. Generators for endpoints/resources/middleware.
6. Storage-backed image optimization.

## Folder Loading Contract

Zero should load these app-owned folders when they exist:

```txt
server/plugins/
server/middleware/
server/endpoints/
server/routes/
```

Load order:

1. `server/plugins`
2. `server/middleware`
3. `server/endpoints`
4. `server/routes`

Rationale:

1. Plugins can install app-level dependencies or route groups.
2. Middleware should wrap endpoints/routes that follow it.
3. Endpoints are the preferred Zero-native API route surface.
4. Routes remain a broader advanced surface and raw Elysia escape hatch.

All folders are optional. Missing folders are ignored.

## Public API

All helpers are exported from `@zero/framework/server`.

### `defineEndpoint()`

Defines one HTTP endpoint.

```ts
export default defineEndpoint({
  method: 'POST',
  path: '/api/customers',
  auth: 'user',
  body: t.Object({
    name: t.String(),
  }),
  handler: async ({ body, user, zero }) => {
    return zero.db.create('customers', {
      customer_id: crypto.randomUUID(),
      owner_id: user.userId,
      name: body.name,
    }).row;
  },
});
```

Supported fields for Phase 1:

| Field | Purpose |
| --- | --- |
| `name` | Optional stable endpoint/plugin name. Defaults from method/path. |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, or `HEAD`. |
| `path` | Route path. |
| `auth` | `false`, `optional`, `user`, or `admin`. Default: `optional`. |
| `body` | Optional Elysia schema. |
| `query` | Optional Elysia schema. |
| `params` | Optional Elysia schema. |
| `headers` | Optional Elysia schema. |
| `response` | Optional Elysia response schema. |
| `beforeHandle` | Optional Elysia before-handle hook(s). |
| `afterHandle` | Optional Elysia after-handle hook(s). |
| `handler` | Endpoint handler with Zero context. |

### `defineRouter()`

Groups endpoints and optional route-level auth.

```ts
export default defineRouter({
  name: 'customers',
  prefix: '/api/customers',
  auth: 'user',
  endpoints: [
    defineEndpoint({
      method: 'GET',
      path: '/',
      handler: ({ zero }) => zero.db.list('customers'),
    }),
  ],
});
```

Routers may include Zero endpoints and raw Elysia plugins for escape hatch use.

### `defineMiddleware()`

Defines named app middleware.

```ts
export default defineMiddleware({
  name: 'audit',
  path: '/api/*',
  run: async ({ request, auth, zero }) => {
    zero.observability.emitEvent({
      level: 'info',
      category: 'app.audit',
      code: 'APP_AUDIT_ROUTE',
      message: 'App route accessed.',
      metadata: {
        path: new URL(request.url).pathname,
        userId: auth?.userId,
      },
    });
  },
});
```

Phase 1 introduced:

1. `name`.
2. Optional `path` matcher or matcher array. String matchers support exact
   paths and trailing `*` prefixes; regular expressions and predicate
   functions are also supported.
3. Optional `auth`.
4. `run()` before handler execution.

Middleware is scoped to the app-owned extension bundle created by the loader.
It wraps app-owned endpoints/routes loaded from the configured server folders
without leaking into Zero's built-in platform routes.

Phase 2 extends this with structured `matcher` policy for method, role, and
configured user properties. See
[`phase-2-middleware-policy.md`](./phase-2-middleware-policy.md).

### `defineZeroPlugin()`

Defines an app plugin with access to Zero services and the underlying Elysia
instance.

```ts
export default defineZeroPlugin({
  name: 'billing',
  setup: ({ app, zero }) => {
    return app.get('/api/billing/status', ({ requireAuth }) => {
      const user = requireAuth();
      return { userId: user.userId, status: 'active' };
    });
  },
});
```

Plugins are for advanced app integration. Regular API routes should prefer
`defineEndpoint()` or `defineRouter()`.

## Backend Context

The app-owned backend context now exposes canonical service names while keeping
compatibility aliases:

```ts
zero.db
zero.syncDB
zero.ai
zero.vector
zero.vectors
zero.email
zero.storage
zero.notifications
zero.scheduler
zero.workflows
zero.workflowRegistry
zero.auth
zero.observability
```

`zero.db` and `zero.syncDB` point to the same ReactiveDB instance.
`zero.vector` and `zero.vectors` point to the same optional vector service.
`zero.auth` exposes lazy store/token helpers, and `zero.observability` exposes
emitters plus runtime/sink/store inspection. The `zero` object is lazy-resolved,
so raw Elysia routes loaded through the same bundle do not need optional
services unless they actually access them. See
[`phase-3-backend-context.md`](./phase-3-backend-context.md).

## Auth Semantics

Endpoint/middleware `auth` values:

| Value | Meaning |
| --- | --- |
| `false` | Do not require auth. Handler receives `auth: null` and `user: null`. |
| `optional` | Do not require auth, but expose auth context when present. |
| `user` | Require any authenticated user. Handler receives non-null `user`. |
| `admin` | Require authenticated admin. Handler receives non-null admin `user`. |

If app auth is disabled, `user` and `admin` requirements should fail with a
clear unauthorized error instead of silently allowing access.

Endpoint-level `auth: 'user'` or `auth: 'admin'` narrows `user` and `auth` to
non-null in that endpoint handler. Router-level auth is still enforced at
runtime for child endpoints and raw route plugins, but child handlers only get
the narrowed local type when they declare their own endpoint auth.

## Module Export Contract

App extension modules may export:

1. `default`
2. `endpoint`
3. `endpoints`
4. `router`
5. `routes`
6. `middleware`
7. `plugin`
8. `plugins`
9. `routers`

Arrays are allowed. Invalid exports throw during startup.

## Tests

Required tests:

1. `defineEndpoint()` mounts an endpoint and exposes `zero.db`.
2. `defineRouter()` mounts grouped endpoints.
3. `defineMiddleware()` can affect matching endpoints without affecting
   unrelated paths.
4. `defineZeroPlugin()` can mount a route using Zero services.
5. Loader accepts Zero-native definitions and raw Elysia plugins.
6. Loader scans `server/plugins`, `server/middleware`, `server/endpoints`, and
   `server/routes` in stable order.
7. Package-mode fixture builds through public `@zero/framework/server` imports.

## Documentation Updates

Update:

1. `docs/framework/api-standardization-plan.md`
2. `docs/framework-developer-surface.md`
3. `docs/start-here.md` if generated-app usage changes
4. `examples/package-mode/README.md`

## Acceptance Criteria

- [x] Zero-native backend definitions exist and are exported from
  `@zero/framework/server`.
- [x] App-owned folders load in the documented order.
- [x] Existing `server/routes` Elysia plugins continue to work.
- [x] Examples use Zero-native definitions first.
- [x] Tests cover route, router, middleware, plugin, loader, and package-mode
  build behavior.
- [x] Docs are updated.
- [x] Obsiian phase tracking is updated.
