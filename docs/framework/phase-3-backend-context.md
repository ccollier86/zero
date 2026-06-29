# Phase 3: Unified Backend Context

Status: implemented

Phase 3 standardizes the backend `zero` context exposed to app-owned server
code. The goal is one learnable service surface for endpoints, routers,
middleware, plugins, and raw `createServerRoute()` handlers, while keeping
existing aliases working.

## Public API

App-owned backend code receives `zero` through:

1. `defineEndpoint()` handlers.
2. `defineRouter()` child endpoints.
3. `defineMiddleware()` handlers.
4. `defineZeroPlugin()` setup callbacks.
5. Raw routes created with `createServerRoute()`.

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/customers',
  auth: 'user',
  handler({ body, user, zero }) {
    return zero.db.insert('customers', {
      customer_id: crypto.randomUUID(),
      owner_id: user.userId,
      name: (body as { name: string }).name,
    }).row;
  },
});
```

## Canonical Services

| Service | Type | Availability |
| --- | --- | --- |
| `zero.db` | `ReactiveDB` | Always available after sync plugin startup. Throws if accessed before sync exists. |
| `zero.auth` | Auth service context | Always present; contained services are `null` when auth is disabled/not started. |
| `zero.ai` | `AIService \| null` | `null` when AI is disabled or not started. |
| `zero.vector` | `VectorService \| null` | `null` when vector storage is disabled or not started. |
| `zero.email` | `EmailService` | Always present; uses a noop provider when email is disabled. |
| `zero.emailRuntime` | `EmailRuntime` | Always present for provider/status inspection. |
| `zero.storage` | `StorageService \| null` | `null` when auth/storage is disabled or not started. |
| `zero.notifications` | `NotificationService \| null` | `null` when auth/notifications are disabled or not started. |
| `zero.scheduler` | `SchedulerService \| null` | `null` before the scheduler plugin starts. |
| `zero.workflows` | `WorkflowService \| null` | `null` when auth/workflows are disabled or not started. |
| `zero.observability` | Observability service context | Always present. |

## Compatibility Aliases

These stay supported for existing apps:

| Alias | Canonical |
| --- | --- |
| `zero.syncDB` | `zero.db` |
| `zero.vectors` | `zero.vector` |
| `zero.workflowRegistry` | workflow registry companion to `zero.workflows` |
| `zero.auth.getTokenService()` | `zero.auth.tokenService` or `zero.auth.tokens` |

Prefer canonical names in new code and docs.

## Auth Context

`zero.auth` is always an object so app code can branch cleanly when auth is
optional:

```ts
const users = zero.auth.store;
const tokens = zero.auth.tokens;

if (!users || !tokens) {
  return { auth: 'disabled' };
}
```

Available fields:

| Field | Meaning |
| --- | --- |
| `store` / `userStore` | Current auth `UserStore`, or `null`. |
| `tokens` / `tokenService` | Current `TokenService`, or `null`. |
| `getStore()` / `getUserStore()` | Lazy auth store getters. |
| `getTokenService()` | Lazy token service getter retained for compatibility. |

Route identity still comes from handler context helpers:

```ts
handler({ requireAuth, zero }) {
  const user = requireAuth();
  return zero.auth.store?.getUserById(user.userId);
}
```

## Observability Context

Use `zero.observability` instead of direct `console.*` in app-owned reusable
backend code:

```ts
zero.observability.emitEvent({
  level: 'info',
  category: 'app.audit',
  code: 'APP_CUSTOMER_VIEWED',
  message: 'Customer viewed.',
  metadata: { customerId },
});
```

Available fields:

| Field | Meaning |
| --- | --- |
| `emitCode()` | Emit a stable Zero platform code. |
| `emitEvent()` | Emit an app-defined event. |
| `info()` / `warn()` / `error()` | Emit a stable code with level override. |
| `runtime` / `getRuntime()` | Current observability runtime. |
| `sink` / `getSink()` | Current write sink. |
| `store` / `getStore()` | Current readable event store, or `null`. |

## Lazy Resolution

The service context uses property getters. That means app plugins can safely
capture `zero` during setup and read optional services later when the request,
job, or workflow runs.

Only `zero.db` and `zero.syncDB` throw when ReactiveDB is missing. Optional
systems return `null` when disabled or not started.

```ts
export default defineZeroPlugin({
  name: 'app.ai-health',
  setup({ app, zero }) {
    return app.get('/api/ai/ready', () => ({
      ready: Boolean(zero.ai),
    }));
  },
});
```

## Exports

Server-only exports from `@zero/framework/server`:

```ts
createServerRoute()
createLazyServerRouteServices()
getServerRouteServices()

type ServerRouteServices
type ServerAuthServices
type ServerObservabilityServices
```

Do not import these from browser/client code.
