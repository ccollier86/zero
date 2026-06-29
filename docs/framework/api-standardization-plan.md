# Framework API Standardization Plan

This plan locks in the next major Zero direction: make package-mode Zero feel
like one coherent app framework while keeping Bun, Elysia, React, and SQLite as
the engine underneath.

The goal is not to hide Elysia from advanced users. The goal is to make normal
app development use Zero-native APIs first, with raw Elysia available as a
deliberate escape hatch.

## North Star

Zero should let a developer or AI agent build a complete data-driven app with:

1. A generated app folder containing only app-owned code.
2. Zero runtime and reusable systems imported from `@zero/framework`.
3. App-owned API routes, middleware, plugins, jobs, resources, workflows, and UI
   composed through consistent Zero APIs.
4. Server-side security and policy defaults that are hard to accidentally
   bypass.
5. Frontend hooks/components that mirror backend features with predictable names.

## Standard API Language

Use these names consistently:

| Pattern | Meaning |
| --- | --- |
| `defineX()` | App-owned declaration such as endpoints, middleware, resources, actions, jobs, and policies. |
| `createXPlugin()` | Framework/plugin factory that returns an Elysia plugin or platform integration. |
| `getX()` | Backend runtime service getter. |
| `useX()` | Frontend React hook. |
| `XProvider` | Frontend context provider. |
| `XGate` | Frontend conditional visibility component. |
| `zero.x` | Backend app route/action context for platform services. |
| `zero.config.ts` | Primary app configuration entry. |
| `config/*.ts` | Optional focused app configuration modules for larger apps. |

Existing APIs should remain compatible while new docs and examples use the
canonical names.

## Canonical App Shape

`create-zero` should stay small, but package-mode should support these optional
folders:

```txt
app/
  layout.tsx
  page.tsx
  server.ts
server/
  routes/
  endpoints/
  middleware/
  plugins/
  actions/
  jobs/
  resources/
  policies/
  workflows/
db/
  schema.ts
config/
  auth.ts
  storage.ts
  ai.ts
  vector.ts
zero.config.ts
```

Generated projects do not need every folder. Zero should load a folder when it
exists and ignore it when it does not.

## Phase 1: Zero-Native Backend Extensions

Status: implemented

Add app-owned extension declarations:

```ts
defineEndpoint()
defineRouter()
defineMiddleware()
defineZeroPlugin()
```

These should compile to named Elysia plugins internally and follow Elysia best
practices:

1. Named plugins.
2. Explicit lifecycle scope.
3. Thin route handlers.
4. Elysia validation for body/query/params/response.
5. Server-side auth and authorization.
6. Zero observability for load failures and runtime errors.

Preferred endpoint shape:

```ts
export default defineEndpoint({
  method: 'POST',
  path: '/api/customers',
  auth: 'user',
  body: t.Object({
    name: t.String(),
  }),
  handler: async ({ body, user, zero }) => {
    return zero.db.insert('customers', {
      customer_id: crypto.randomUUID(),
      owner_id: user.userId,
      name: body.name,
    }).row;
  },
});
```

Preferred router shape:

```ts
export default defineRouter({
  name: 'customers',
  prefix: '/api/customers',
  auth: 'user',
  endpoints: [
    defineEndpoint({
      method: 'GET',
      path: '/',
      handler: ({ zero }) => zero.db.query('customers'),
    }),
  ],
});
```

Preferred plugin shape:

```ts
export default defineZeroPlugin({
  name: 'billing',
  setup: ({ app, zero }) => {
    return app.get('/api/billing/status', ({ requireAuth }) => {
      const user = requireAuth();
      return getBillingStatus(user.userId);
    });
  },
});
```

Acceptance criteria:

1. `server/plugins`, `server/middleware`, `server/endpoints`, and
   `server/routes` are loaded from app source.
2. Existing raw Elysia route modules continue to work.
3. Zero endpoint/router/middleware/plugin modules are normalized by the loader.
4. Tests prove loaded extensions can use auth helpers and `zero` services.
5. Docs show Zero-native APIs first and raw Elysia as the advanced escape hatch.

## Phase 2: Middleware Matchers And Policy

Status: implemented

Middleware matchers support path, method, auth, role, and configured user
properties:

```ts
defineMiddleware({
  name: 'accounting-only',
  matcher: {
    path: '/accounting/:path*',
    method: ['GET', 'POST'],
    auth: 'user',
    role: ['admin', 'manager'],
    properties: {
      department: ['accounting', 'management'],
    },
  },
  run: async ({ request, user, zero }) => {
    zero.observability.emitEvent({
      level: 'info',
      category: 'app.audit',
      code: 'APP_ACCOUNTING_ACCESS',
      message: 'Accounting route accessed.',
      metadata: {
        path: new URL(request.url).pathname,
        userId: user.userId,
      },
    });
  },
});
```

Implemented matcher behavior:

1. Path patterns are simple and predictable.
2. Auth requirements are enforced server-side.
3. Metadata/property checks use the same configured user property system
   as auth/admin UI.
4. Path/method decide applicability, while auth/role/properties are fail-closed
   authorization requirements once a route applies.
5. Frontend gates and backend matchers can share vocabulary.
6. Doctor should warn on impossible or unsafe matchers in a later CLI phase.

Later auth polish:

```ts
auth: {
  registration: {
    mode: 'public',
    defaultProperties: {
      plan: 'free',
      onboarding_status: 'new',
    },
  },
}
```

Existing `auth.userProperties` defaults already apply to public/bootstrap
registration and admin-created accounts. Phase 2 uses that system instead of
adding a second default metadata config. A future auth phase may add an
explicit open-registration default metadata shape, but public registration must
not let users self-assign privileged metadata unless the app explicitly allows
that key/value.

Acceptance criteria:

1. Middleware can target route patterns without becoming global accidentally.
2. User metadata/property checks are documented and covered by tests.
3. Matchers fail closed when auth, role, or property requirements are not met.
4. Matcher and policy evaluation live outside `server-extensions.ts` so
   resources/actions can reuse them later.
5. Open-registration default metadata is confirmed through existing
   `auth.userProperties` behavior; any extra public-registration metadata
   defaults are captured as a separate auth phase.

## Phase 3: Unified Backend Context

Status: planned

Standardize app backend context around:

```ts
zero.db
zero.auth
zero.ai
zero.vector
zero.email
zero.storage
zero.notifications
zero.scheduler
zero.workflows
zero.observability
```

Keep compatibility aliases:

```ts
zero.syncDB
zero.vectors
zero.workflowRegistry
```

Acceptance criteria:

1. New examples use canonical names.
2. Existing apps keep working.
3. Type hints are clear for nullable optional systems such as AI/vector/storage.
4. Services are exposed consistently in endpoints, routers, middleware, plugins,
   actions, jobs, and workflows.

## Phase 4: Service API Smoothing

Status: planned

Audit every backend service for naming consistency:

1. Auth user/admin APIs.
2. Storage service.
3. Notification service.
4. Workflow service.
5. Scheduler.
6. AI service.
7. Vector service.
8. Email service.
9. Sync/ReactiveDB.
10. `/api/data`.
11. Observability.
12. Migrations.

Preferred naming vocabulary:

```ts
create()
get()
list()
update()
delete()
run()
start()
stop()
status()
```

Do not force every service into every method. Use the vocabulary where it fits.

Acceptance criteria:

1. Each feature has documented backend usage.
2. Rough legacy names get compatibility aliases when practical.
3. New names appear in docs and generated examples.
4. Tests cover aliases when compatibility matters.

## Phase 5: Resource And Policy API

Status: planned

Add a high-level resource abstraction for common data-driven apps:

```ts
defineResource({
  table: 'customers',
  primaryKey: 'customer_id',
  policy: ownerPolicy('owner_id'),
  actions: ['list', 'get', 'create', 'update', 'delete'],
});
```

Resource definitions can eventually produce:

1. Safe CRUD endpoints.
2. `/api/data` query policy.
3. Sync policy.
4. Frontend hooks.
5. Default DataTable/MasterDetail wiring.
6. Doctor checks for indexes, primary keys, and policy gaps.

Policy presets should include:

```ts
ownerPolicy('owner_id')
adminOnly()
authenticatedOnly()
publicReadUserWrite()
readOnly()
metadataPolicy({ department: 'accounting' })
```

Acceptance criteria:

1. Resource API is optional, not required for custom apps.
2. Generated endpoints enforce authorization server-side.
3. Policies compose with platform protected table rules.
4. Docs explain when to use resource API versus custom endpoints.

## Phase 6: Actions

Status: planned

Add server actions for common commands:

```ts
export const createCustomer = defineAction({
  auth: 'user',
  input: t.Object({
    name: t.String(),
  }),
  run: async ({ input, user, zero }) => {
    return zero.db.insert('customers', {
      customer_id: crypto.randomUUID(),
      owner_id: user.userId,
      name: input.name,
    }).row;
  },
});
```

Frontend support can come later:

```ts
const createCustomer = useAction('createCustomer');
```

Acceptance criteria:

1. Actions reuse endpoint validation/auth/policy machinery.
2. Actions are callable from server code first.
3. Frontend transport is added only after backend contracts are stable.

## Phase 7: Frontend Parity

Status: planned

Each backend feature should have an obvious frontend hook/component story:

| Backend Feature | Frontend Surface |
| --- | --- |
| Auth | `useAuth()`, `useCurrentUser()`, `SignedIn`, `AdminGate`, `PropertyGate`. |
| Resources | `useResource()`, `useResourceRecord()`, generated DataTable helpers. |
| Actions | `useAction()`, action status/loading/error state. |
| Storage | `useStorageBrowser()`, `StorageManagement`, `StorageDropzone`, future `Image`. |
| Notifications | `useNotifications()`, `NotificationCenter`. |
| Workflows | `useWorkflowRun()`, workflow status/progress components. |
| Sync/state | `useCollection()`, `useDataPage()`, `useServerState()`. |
| Observability | frontend sink and dev diagnostics. |

Acceptance criteria:

1. Frontend hooks reuse SDK transport/auth.
2. Hooks are SSR-safe.
3. Components stay render-focused and do not own transport policy.

## Phase 8: Framework Conveniences Borrowed From Other Frameworks

Status: planned

Adopt useful ideas without copying whole frameworks:

1. Next-style middleware matchers.
2. Next-style route handlers, adapted to Zero endpoint definitions.
3. Zero server actions.
4. Rails/Laravel-style generators, but small and transparent.
5. Remix-style loaders/actions where they fit the existing router.
6. Storage-backed `Image` component.
7. Optional partial hydration/islands later for performance.

Potential `Image` target:

```tsx
<Image
  fileId={user.avatar_file_id}
  alt="Profile"
  width={160}
  height={160}
  fit="cover"
  variant="avatar"
/>
```

Because Zero owns storage, this can eventually support signed URLs, variants,
cache headers, avatar presets, and local development behavior.

## Phase 9: CLI, Doctor, And Generators

Status: planned

CLI should grow carefully:

```sh
zero generate endpoint customers.create
zero generate middleware require-accounting
zero generate resource customers
zero add components/data-table
zero doctor --strict
zero migrate:plan
```

Doctor should check:

1. Invalid extension exports.
2. Middleware matcher mistakes.
3. Missing auth config for protected matchers.
4. Unknown metadata/property keys.
5. Resource definitions without primary keys or useful indexes.
6. Unsafe app-table sync/query policies.
7. Missing env for enabled email/AI/vector/storage features.

Acceptance criteria:

1. Generators create small files that teach the expected pattern.
2. Doctor warnings are actionable.
3. `--strict` can fail CI.

## Phase 10: Documentation Standardization

Status: planned

Every feature doc should follow this shape:

1. What it does.
2. Configuration.
3. Backend usage.
4. Frontend usage.
5. Security notes.
6. Common recipes.
7. Doctor checks.
8. Example app snippet.

`docs/start-here.md` should remain the map. Detailed feature docs should own
the deeper examples.

## Tracking Checklist

- [x] Phase 1: Zero-native backend extension APIs.
- [x] Phase 2: Middleware matchers and metadata policy.
- [ ] Phase 3: Unified backend `zero` context.
- [ ] Phase 4: Service API smoothing.
- [ ] Phase 5: Resource and policy API.
- [ ] Phase 6: Actions.
- [ ] Phase 7: Frontend parity.
- [ ] Phase 8: Borrowed framework conveniences.
- [ ] Phase 9: CLI, doctor, and generators.
- [ ] Phase 10: Documentation standardization.

## Implementation Rules

1. Preserve existing app compatibility.
2. Keep raw Elysia available as an explicit escape hatch.
3. Prefer Zero-native APIs in docs and generated apps.
4. Keep each file responsible for one layer or concern.
5. Route warnings/errors/logs through the observability boundary.
6. Update docs after each implemented phase.
7. Track phase progress in Obsiian and checkpoint meaningful work.
