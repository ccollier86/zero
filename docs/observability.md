# Observability

Zero ships a native observability boundary for logs, warnings, errors, and
frontend/backend events.

The default behavior is useful without configuration:

1. Events are formatted to the console with stable Zero prefixes.
2. Events are stored in a bounded in-memory event store.
3. Recent events are available through a protected platform endpoint.
4. Frontend events can be ingested by the backend through the same endpoint.
5. Apps can replace or compose sink/store adapters.

OpenTelemetry is intentionally not part of this first slice. It can be added
later as an adapter.

## Event Shape

Every event has stable fields:

```ts
interface PlatformEvent {
  id: string;
  sequence: number;
  timestamp: number;
  source: 'backend' | 'frontend' | 'cli' | 'test';
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  code: string;
  prefix: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
  requestId?: string;
  userId?: string;
  traceId?: string;
}
```

Example console output:

```txt
2026-06-28T12:00:00.000Z WARN [ZERO_SYNC_MODE_AUTO_LAZY] sync.mode.auto_lazy: Table "audit_log" auto-resolved to lazy sync.
```

## App Configuration

`createApp()` enables observability by default.

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  observability: {
    maxEvents: 1000,
    endpoint: {
      enabled: true,
      basePath: '/api/_zero/observability',
      read: 'admin-or-dev',
      frontendIngest: true,
    },
  },
});
```

Set `observability: false` to disable the runtime.

## Default Endpoint

Recent events are available at:

```txt
GET /api/_zero/observability/events
```

Supported query parameters:

| Param | Description |
| --- | --- |
| `level` | One level or comma-separated levels. |
| `category` | Exact category filter. |
| `code` | Exact event code filter. |
| `source` | `backend`, `frontend`, `cli`, or `test`. |
| `since` | Unix timestamp in milliseconds. |
| `cursor` | Return events after a previous sequence number. |
| `limit` | Page size, capped at 1000. |

Frontend event ingest uses:

```txt
POST /api/_zero/observability/events
```

The ingest route is write-only. It does not expose stored events.

## Access Policy

Endpoint read access defaults to:

1. `admin` when auth is enabled.
2. `development` when auth is disabled.

Supported read modes:

```ts
read: 'admin' | 'development' | 'admin-or-dev' | 'disabled' | ((ctx) => boolean | Promise<boolean>)
```

Custom example:

```ts
observability: {
  endpoint: {
    read: ({ authContext }) => authContext?.role === 'admin',
  },
}
```

Run platform doctor after changing observability config:

```txt
bun run doctor -- --config ./zero.config.ts
```

Doctor warns when observability is disabled in production, when endpoint read
policy is unreachable for the current auth mode, and when the HTTP endpoint is
enabled while the readable event store is disabled.

## Custom Sinks

The sink is write-only by design. If an app needs queryable data, provide a
store separately.

```ts
import {
  CompositeSink,
  ConsoleSink,
  MemoryEventStore,
  createApp,
} from '@zero/framework/server';

const store = new MemoryEventStore({ maxEvents: 10_000 });

const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  observability: {
    store,
    sink: new CompositeSink([
      new ConsoleSink(),
      store,
      {
        emit(event) {
          // send to a file, HTTP endpoint, Sentry, etc.
        },
      },
    ]),
  },
});
```

## Runtime Ownership

`createApp()` stores the resolved observability runtime on that app's
`ZeroAppRuntime`. Managed Auth and its email, native-auth, request, and worker
paths receive an emitter bound to that exact runtime. Starting another app in
the same process, or later changing the process default, cannot redirect those
events into the other app's sink or store. Managed composition fails when its
required observability service is missing instead of silently falling back to
another runtime.

The no-target `configureObservability()` and `emitPlatformCode()` APIs remain
an intentional process-wide compatibility boundary for manually composed or
standalone services. Direct Auth/email constructors that omit an injected
emitter use that boundary too. A process hosting more than one manually
composed app must inject an app-bound emitter; the compatibility default is not
an app-discovery or isolation mechanism.

## Emitting Backend Events

Use stable codes from `OBS_CODES`.

```ts
import { OBS_CODES, emitPlatformCode } from '@zero/framework/server';

emitPlatformCode(OBS_CODES.APP_LISTENING, {
  metadata: { port: 3000 },
});
```

## Frontend Sink

The frontend barrel exports a browser-side sink. By default it writes to the
browser console and posts to `/api/_zero/observability/events`.

```tsx
import {
  configureFrontendObservability,
  emitFrontendCode,
  FRONTEND_OBS_CODES,
} from '@zero/framework/react';

configureFrontendObservability({
  endpoint: '/api/_zero/observability/events',
});

emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_RENDER_ERROR, {
  message: 'Widget failed to render',
});
```

`ErrorBoundary`, hydration failures, and notification receipt failures already
emit through this frontend boundary.

## Auth Operational Failure Contract

Auth keeps operational events separate from its durable
[control-plane audit](./auth/control-plane-audit.md). The audit proves bounded
security-state transitions; the events below report runtime health, rejected
postconditions, and external delivery failures.

| Event | Meaning and safe fields |
| --- | --- |
| `AUTH_START_FAILED` | The one shared Auth startup promise rejected. Request admission awaits that same promise, and the plugin contains the failed runtime by stopping it, unregistering compatibility state, and closing a standalone listener when present. Metadata is limited to the plugin identity; cleanup/listener failures use the normal app lifecycle failure event. |
| `AUTH_STATE_INVARIANT_FAILED` | An internal state, wiring, transaction-callback, or mutation-postcondition check failed closed. Request-path services use the owning app's emitter and bounded `component` / `invariant` metadata; identifiers, submitted values, and credentials are not metadata. The operation throws `AuthError` with the same machine code and rolls back when it is inside a transaction. |
| `AUTH_NATIVE_REQUEST_FAILED` | A native authorize, token, revoke, tenant-list, or tenant-switch boundary hid an unexpected internal or unavailable-runtime failure behind a protocol-safe OAuth response. Expected OAuth/OIDC rejections—including `NativeAuthorizationError` and `NativeTokenError` outcomes—do not create this operational error. Only the bounded operation name is emitted; the provider/database error, form body, and tokens are omitted. |
| `AUTH_ADMIN_EMAIL_VERIFICATION_DELIVERY_FAILED`, `AUTH_ADMIN_SETUP_DELIVERY_FAILED`, `AUTH_ADMIN_PASSWORD_RESET_DELIVERY_FAILED` | Administrator-triggered verification, setup, and reset delivery failed. Events attribute the actor and target IDs and include cleanup success plus a stable failure classification and retryability; recipient/provider text and the original error are omitted. `AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED` separately records whether compensating removal of a newly provisioned user succeeded. |
| `FRONTEND_AUTH_ACTION_FAILED` | A current-scope load or mutation in the application-access, Administration Organization, customer-organization, tenant-member, tenant-onboarding, or tenant-switcher hooks failed. One shared reporter emits the bounded action family and safe machine code; response details are not copied into metadata. |

Auth HTTP boundaries preserve actionable messages for expected 4xx
`AuthError`s. For a 5xx `AuthError`, the `/auth` namespace, Auth middleware,
and the Notifications, Storage, Scheduler, and Rooms plugins preserve its HTTP
status and machine-readable `code` but replace the client message with
`Authentication service unavailable`. Unexpected non-Auth errors at the Auth
namespace become the generic `AUTH_INTERNAL_ERROR` response. Operators use the
app-local event stream for diagnosis; private server diagnostics are not
reflected into the response.

The development `ConsoleEmailProvider` also emits rather than printing a
message preview. `EMAIL_CONSOLE_PREVIEW` contains recipient count and Boolean
sender/text/HTML presence only. It never includes addresses, sender, subject,
text, or HTML, and managed email runtimes emit it to their owning app.

See [Auth System](./auth/README.md) for account/delivery behavior and
[Native App Auth](./auth/native-app-auth.md) for the public-client protocol.

## Trace

Elysia `trace()` support is available behind a feature flag:

```ts
observability: {
  trace: {
    enabled: true,
    slowRequestMs: 500,
    slowLifecycleMs: 100,
  },
}
```

Trace emits stable Zero events such as:

- `app.request.slow`
- `app.lifecycle.slow`
- `app.lifecycle.failed`

Trace is optional because Elysia trace does not support dynamic `aot: false`
mode.

## Current Routed Paths

The first implementation routes these platform paths through the sink:

- app factory client bundle/startup/shutdown messages
- example app listen message
- auth, sync, storage, notifications, rooms, scheduler, and workflow lifecycle
- scheduler job failures
- ReactiveDB change-listener failures
- sync-mode startup warnings
- sync policy callback failures
- SSR renderer failures
- router layout-config import failures
- frontend ErrorBoundary and hydration failures
- frontend auth session redirects
- frontend notification receipt failures
- frontend storage management action failures
- migrator library logs
- AI provider setup, skipped providers, request lifecycle, request failures,
  unresolved aliases, status access denials, and tool execution failures
- vector runtime configuration, index initialization, operation completion,
  and operation/index failures

CLI presentation in `src/migrations/run.ts` intentionally remains direct
console output because it is command UI.

## Engineering Rule

Use this system for all new reusable platform work.

New backend/frontend code should not add ad-hoc `console.log`,
`console.warn`, or `console.error` calls for platform logs, warnings, caught
errors, or lifecycle events. Add or reuse a stable `OBS_CODES` entry and emit
through the backend or frontend observability boundary.

When continuing platform hardening, correct touched code that bypasses this
boundary unless it is intentionally CLI presentation or an observability adapter
itself.

## Deferred: User Activity Audit

User activity audit is related but separate. It should be an optional,
feature-flagged system for apps that need accountability records such as page
views, data reads, data writes, query shape, record ids, and duration on page.

Do not mix audit records into the default observability stream. Observability
tracks platform health. Audit tracks user activity.
