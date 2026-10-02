# Observability Audit

> **Status:** historical pre-implementation audit. Zero now has the shared
> observability sink, stable event codes, bounded event store, protected event
> routes, frontend reporting, and tracing described in
> [Observability](./observability.md). The findings below preserve the baseline
> that motivated that work; they are not current runtime claims.

This records the earlier audit of Zero's logging, warnings, errors, and audit
paths before the first-class platform sink layer landed.

## Summary

Zero has several good local error-handling pieces, but it does not yet have a
single controlled observability path.

The current platform has:

1. Feature-level Elysia `onError` handlers for auth-shaped HTTP responses.
2. A frontend `ErrorBoundary` that catches render errors.
3. SDK/client `onError` callbacks for WebSocket connection failures.
4. Migration doctor findings and schema diff warnings.
5. A migrator `log` function injection point.
6. A small sync-mode resolver logger interface.

The current platform does not yet have:

1. A shared backend logger/sink contract.
2. A shared frontend reporting sink.
3. Structured event codes/categories across modules.
4. A consistent warning channel that can later feed doctor/CI/Sentry/OTel.
5. Centralized platform `onError` reporting for unhandled Elysia errors.
6. Runtime audit/activity tracking implementation, despite docs describing the
   intended design.

## Existing Controlled Paths

### Auth And HTTP Errors

Auth defines `AuthError` with a message, machine code, and HTTP status.

Implemented in:

- `src/auth/types.ts`
- `src/auth/auth.plugin.ts`
- `src/auth/auth.middleware.ts`

Consumers such as auth, notifications, rooms, scheduler, and storage use
feature-level `.onError()` handlers to convert `AuthError` into JSON responses.
Storage also maps `StorageError` to HTTP JSON responses.

This is response shaping, not observability. These errors are not emitted to a
shared sink.

### Frontend Render Errors

`src/frontend/client/error-boundary.tsx` catches React render errors, calls an
optional `onError`, then logs to `console.error`.

`AppProvider` and `hydrate.tsx` wrap UI with this boundary.

This protects the user experience, but the default path is still direct console
logging. There is no default remote or platform sink.

### Sync Client Errors

The sync client accepts `onError?: (error: string) => void`.

Implemented in:

- `src/sync/client/sync-client.ts`
- `src/frontend/client/sdk.ts`

It reports unrecoverable connection cases such as auth close codes and maximum
reconnect attempts. Browser WebSocket `onerror` itself is intentionally ignored
because browsers do not expose useful error detail there.

This is useful but narrow. It is callback-only and does not receive structured
event metadata.

### Sync Mode Warnings

`src/frontend/server/sync-mode-resolver.ts` has a tiny logger contract:

```ts
export interface SyncModeResolverLogger {
  warn(message: string): void;
  log(message: string): void;
}
```

It warns when:

1. An explicit full-sync table exceeds the auto-lazy row limit.
2. Auto mode is configured to warn instead of switching to lazy.
3. A table auto-resolves to lazy mode.

This is the closest existing shape to a controlled warning path, but it still
defaults to `console` and only covers one subsystem.

### Migrations

`Migrator` accepts `log?: (...args: unknown[]) => void`.

Implemented in:

- `src/migrations/migrator.ts`
- `src/migrations/types.ts`

The migration doctor returns structured findings:

- `severity`
- `code`
- `message`

Implemented in:

- `src/migrations/migration-doctor.ts`
- `src/migrations/schema-diff.ts`

This is good precedent for the platform sink API: warnings and errors should
carry codes and severity, not just strings.

The CLI in `src/migrations/run.ts` should keep console output because it is a
human-facing command-line tool, but it can later format events emitted by the
same core contracts.

### Workflow Events

The workflow subsystem no longer logs lifecycle state directly to the console.
It emits stable platform codes through the observability sink for startup,
shutdown, recovery, instance lifecycle, retry scheduling, timeouts, and missing
handlers. The graph runtime adds stable definition publish/activate/retire,
node, choice, parallel/join, fan-out, memory, and interaction lifecycle codes.
Background frontier failures emit `workflows.advance.failed` instead of
becoming unhandled promise rejections. Request failures also use the shared
safe request-failure path, while HTTP responses expose stable `WORKFLOW_*`
domain codes without leaking internal 5xx details or private graph, memory, or
interaction/event/delivery payloads. See
[Durable Workflows](./workflows.md#observability-and-errors).

### Defensive Silent Denials

`src/sync/sync-policy.ts` catches policy callback exceptions and normalizes
them to deny decisions.

This is the right security posture: fail closed instead of crashing open.

However, these exceptions are currently silent. A future sink should receive a
structured warning/error event when a policy callback throws.

## Direct Console Usage

Current non-test direct console usage appears in:

- `app/server.ts`
- `src/auth/auth.plugin.ts`
- `src/frontend/client/error-boundary.tsx`
- `src/frontend/client/notification-hooks.ts`
- `src/frontend/router/renderer.ts`
- `src/frontend/router/route-tree.ts`
- `src/frontend/server/app-factory.ts`
- `src/frontend/server/router-plugin.ts`
- `src/migrations/migrator.ts`
- `src/migrations/run.ts`
- `src/notifications/notification.plugin.ts`
- `src/rooms/room.plugin.ts`
- `src/scheduler/scheduler.plugin.ts`
- `src/scheduler/scheduler-service.ts`
- `src/storage/storage.plugin.ts`
- `src/sync/reactive-db.ts`
- `src/sync/sync.plugin.ts`

There are also direct console calls inside bundled UI/demo-style components
under `src/components/animate-ui`. Those are lower priority than platform core.

The most important backend console paths to route first are:

1. Plugin lifecycle logs: auth, sync, storage, rooms, notifications, scheduler,
   app factory shutdown.
2. Runtime error catches: ReactiveDB listener errors, scheduler job errors,
   SSR render errors, hydrate errors.
3. Startup warnings: client bundle fallback, router layout config import
   failure, sync-mode decisions.

## Audit/Activity Tracking

Docs describe a planned audit/activity system:

- `docs/auth/guards-and-audit.md`
- `docs/auth/architecture.md`
- `docs/build-plan.md`

The runtime source does not currently implement that design.

Missing from `src/auth`:

- `activity-tracker.ts`
- `audit.middleware.ts`
- `_audit_log` table creation
- automatic request/data access/session audit draining

This should be treated as a separate product/security feature, not as the same
thing as platform observability. Observability reports platform health and
errors. Audit records user/application activity for accountability.

## Recommended Design Direction

Add a small internal observability layer first, then adapters later.

Recommended modules:

- `src/observability/types.ts`
- `src/observability/console-sink.ts`
- `src/observability/memory-event-store.ts`
- `src/observability/composite-sink.ts`
- `src/observability/sink.ts`
- `src/observability/codes.ts`
- `src/observability/index.ts`

Recommended core contract:

```ts
type PlatformEventLevel = 'debug' | 'info' | 'warn' | 'error';

interface PlatformEvent {
  level: PlatformEventLevel;
  category: 'app' | 'auth' | 'sync' | 'storage' | 'scheduler' | 'migrations' | 'frontend' | string;
  code: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  error?: unknown;
}

interface PlatformSink {
  emit(event: PlatformEvent): void | Promise<void>;
}

interface PlatformEventStore {
  emit(event: PlatformEvent): void | Promise<void>;
  query(options: PlatformEventQuery): PlatformEventPage;
}
```

The sink contract should remain write-only. The default platform access point
should read from a queryable event store. This keeps dependency inversion clean:
users can send events to console, files, HTTP, Sentry, OpenTelemetry, or a
custom backend without every adapter needing to expose a read/query API.

Recommended helpers:

- `setPlatformSink(sink)`
- `getPlatformSink()`
- `emitPlatformEvent(event)`
- `logPlatformInfo(category, code, message, metadata?)`
- `warnPlatform(category, code, message, metadata?)`
- `errorPlatform(category, code, message, error?, metadata?)`

Default sink and access point:

- Console-backed for normal developer visibility.
- Bounded in-memory event store for runtime inspection.
- Composite by default: console sink + memory event store.
- Preserves current developer experience.
- Formats readable messages.
- Does not throw if the sink itself fails.
- Exposes a protected platform endpoint for recent events.
- Allows custom sink/store adapters to replace or extend the default behavior.

Recommended default endpoint:

- `GET /api/_zero/observability/events` returns recent event pages.
- `POST /api/_zero/observability/events` accepts browser/frontend event reports
  when frontend capture is enabled.
- Optional later: `GET /api/_zero/observability/stream` for Server-Sent Events.

Endpoint access policy:

- If auth is enabled, read access defaults to admin-only.
- If auth is disabled, read access defaults to development-only and should be
  disabled in production unless an app explicitly provides an access policy.
- Frontend event ingest may be enabled by default, but must be size-limited,
  redacted, same-origin by default, and write-only.

Recommended config shape:

```ts
createApp({
  observability: {
    sink: undefined, // Defaults to console + memory store
    store: undefined, // Defaults to bounded memory event store
    endpoint: {
      enabled: true,
      basePath: '/api/_zero/observability',
      read: 'admin-or-dev',
      frontendIngest: true,
    },
  },
});
```

Apps that want full control can replace the boundary:

```ts
createApp({
  observability: {
    sink: new CompositeSink([
      new ConsoleSink(),
      new SentrySink(),
      new OpenTelemetrySink(),
    ]),
    store: new SqliteEventStore({ maxEvents: 10_000 }),
    endpoint: {
      read: ({ authContext }) => authContext?.role === 'admin',
    },
  },
});
```

Optional test sink:

- Memory-backed.
- Allows tests to assert emitted warnings/errors without scraping console.

## Elysia Trace Integration

Elysia `trace()` should be used as the request lifecycle timing layer, not as
the core platform event contract.

Trace is a good fit for:

1. Per-request lifecycle timings.
2. Slow request and slow lifecycle warnings.
3. Handler/hook error reporting with lifecycle names.
4. Naming pressure: named handlers produce better trace labels than anonymous
   arrows.
5. Optional request response headers in development, such as elapsed time.

Trace should emit into the Zero sink with stable codes, for example:

- `app.request.slow`
- `app.lifecycle.slow`
- `app.lifecycle.failed`
- `app.request.failed`

Trace metadata should include:

- request id
- method
- path
- lifecycle name
- handler name
- elapsed milliseconds
- response status when available

Trace must be optional/configurable because it depends on Elysia's static/AOT
mode and does not work with dynamic `aot: false`.

Recommended config shape:

```ts
createApp({
  observability: {
    trace: {
      enabled: true,
      slowRequestMs: 500,
      slowLifecycleMs: 100,
    },
  },
});
```

The Trace plugin should be installed through the platform observability Elysia
plugin so request metadata, errors, lifecycle timing, and sink emission stay in
one backend integration point.

## Future OpenTelemetry Bridge

OpenTelemetry should be left out of the first implementation slice. Later, it
can be supported as an adapter/bridge, not as the only Zero observability
contract.

Zero needs stable warning/error/log codes for product ergonomics and support.
OpenTelemetry is better suited for spans, traces, metrics, and external
observability backends.

Recommended policy:

1. Keep Zero-native event codes and sink contracts as the source of truth.
2. Add an OpenTelemetry adapter that converts relevant Zero events into span
   events, attributes, or exceptions.
3. Allow users to pass `@elysia/opentelemetry` configuration through the
   platform observability plugin.
4. Prefer named Elysia handlers and lifecycle hooks so OpenTelemetry and Trace
   spans are readable.

## Deferred User Activity Audit

User activity audit is a separate optional feature from platform
observability.

It should reuse the same adapter discipline, but it should not share the same
event stream by default. Observability answers "is the platform healthy and
what failed?" Activity audit answers "which authenticated user accessed or
changed which data, when, through which screen/query/action?"

The audit system should be feature-flagged and privacy-first because apps may
use it for regulated workflows such as HIPAA-style access accountability.

Possible future config shape:

```ts
createApp({
  audit: {
    enabled: true,
    capturePages: true,
    captureReads: true,
    captureWrites: true,
    captureDurations: true,
    sink: undefined, // file-backed default or user adapter
  },
});
```

Audit events should be explicit and stable, for example:

- `audit.page.viewed`
- `audit.page.duration`
- `audit.data.read`
- `audit.data.created`
- `audit.data.updated`
- `audit.data.deleted`
- `audit.auth.login`
- `audit.auth.logout`

Audit metadata may include:

- user id
- session id
- route/path
- table name
- record ids returned or changed
- query/filter shape
- action duration
- client/source metadata

Audit metadata must avoid storing secrets, raw tokens, password fields, full
request bodies, and unnecessary PHI by default. For regulated apps, defaults
should prefer record identifiers and query shapes over full data snapshots
unless the app explicitly opts into richer capture.

This belongs after the observability sink layer exists. Do not implement it in
the first observability slice.

## Integration Order

1. Add backend sink contracts and console sink.
2. Add the Elysia observability plugin for request ids, global error reporting,
   optional Trace, and optional OpenTelemetry.
3. Route core backend lifecycle logs through the sink.
4. Route runtime caught errors through the sink:
   - `ReactiveDB.emitChange`
   - `SchedulerService` job errors
   - SSR renderer errors
   - router layout config import failures
5. Let `createApp()` accept an optional sink/config and install it once at the
   composition root.
6. Wire migration core to the same contract while keeping CLI formatting.
7. Add frontend sink separately:
   - ErrorBoundary reporting
   - hydration failures
   - SDK sync unrecoverable errors
8. Add adapters later:
   - file sink
   - HTTP sink
   - Sentry adapter
   - OpenTelemetry-shaped adapter

## Policy

The sink should be best-effort only. Observability failures must never break
request handling, sync mutation handling, migrations, or shutdown.

Security-sensitive failures should use stable codes and structured metadata.
Examples:

- `sync.policy.callback_failed`
- `sync.policy_state.failed`
- `sync.listener.failed`
- `scheduler.job.failed`
- `app.client_bundle.failed`
- `router.layout_config.failed`
- `auth.token.invalid`

Do not log secrets, raw access tokens, refresh tokens, password hashes, file
contents, or full request bodies by default.

## Next Slice

Implement the backend sink layer first and convert platform-owned backend
console paths. Leave the audit/activity tracking implementation as a later
feature slice after the sink exists.
