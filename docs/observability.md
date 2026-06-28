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
import { createApp } from '@platform/server';

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

## Custom Sinks

The sink is write-only by design. If an app needs queryable data, provide a
store separately.

```ts
import {
  CompositeSink,
  ConsoleSink,
  MemoryEventStore,
  createApp,
} from '@platform/server';

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

## Emitting Backend Events

Use stable codes from `OBS_CODES`.

```ts
import { OBS_CODES, emitPlatformCode } from '@platform/server';

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
} from '@platform/frontend';

configureFrontendObservability({
  endpoint: '/api/_zero/observability/events',
});

emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_RENDER_ERROR, {
  message: 'Widget failed to render',
});
```

`ErrorBoundary`, hydration failures, and notification receipt failures already
emit through this frontend boundary.

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
