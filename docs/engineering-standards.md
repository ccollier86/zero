# Engineering Standards

Use this document with `docs/platform-hardening-plan.md` and `docs/elysia-practices-audit.md`. These standards apply to backend and frontend work unless a narrower module convention says otherwise.

## 1. Core Principles

### 1.1 SOLID

Code should follow SOLID principles pragmatically:

1. **Single Responsibility**: each module, class, service, plugin, hook, and component should have one clear reason to change.
2. **Open/Closed**: extension points should be added through config, policy functions, service methods, or small adapters instead of editing unrelated modules.
3. **Liskov Substitution**: interfaces and adapters should behave consistently wherever they are accepted.
4. **Interface Segregation**: avoid large catch-all interfaces. Consumers should depend only on methods and data they actually need.
5. **Dependency Inversion**: high-level modules should depend on abstractions or explicit config contracts, not hidden concrete globals, unless the platform deliberately owns a singleton.

### 1.2 Separation Of Concerns

Keep concerns split by layer:

1. Elysia plugins own routing, lifecycle, dependency declaration, request validation, and HTTP/WebSocket transport.
2. Services own business logic and should not depend on Elysia request context.
3. Stores and database wrappers own persistence mechanics.
4. SDK clients own client-side transport, auth reuse, optimistic state, and ergonomic APIs.
5. React hooks own reactive subscriptions and UI-facing state shape.
6. Components own rendering and interaction, not persistence or transport policy.

### 1.3 Explicit Responsibilities

Every durable module should make its responsibility obvious from its filename, exports, and top-level comment.

Avoid modules that mix:

1. Routing and business rules.
2. Auth verification and domain behavior.
3. SQL construction and UI state.
4. React rendering and low-level network protocol.
5. Test-only behavior and production behavior.

## 2. File Front Matter

New or substantially edited source files should start with a short file-level comment when the file owns durable platform behavior.

The front matter should answer:

1. What this file owns.
2. What layer it belongs to.
3. Which dependencies it intentionally consumes.
4. What it should not do.

Example:

```ts
/**
 * sync-policy.ts
 *
 * Defines the sync authorization policy contract used by the WebSocket sync
 * layer. This file owns policy types and default decisions only; it does not
 * verify JWTs, mutate SQLite, or publish WebSocket messages.
 */
```

Do not add heavy file front matter to tiny barrel files unless it clarifies import boundaries.

## 3. Method And Function Comments

Public exported functions, classes, interfaces, hooks, and plugin factories should have concise signature comments.

Comments should explain:

1. Purpose.
2. Inputs that affect behavior.
3. Return value or side effects.
4. Security or lifecycle constraints when relevant.

Example:

```ts
/**
 * Verify a WebSocket access token and return the auth context used by sync.
 *
 * Returns null for missing or invalid tokens so the caller can decide whether
 * anonymous sync is allowed for the current app configuration.
 */
async function verifySyncToken(token: string | undefined): Promise<AuthContext | null> {
  // ...
}
```

Avoid comments that restate the code:

```ts
// Bad: increments count
count++;
```

Prefer comments that explain policy, lifecycle, security, non-obvious tradeoffs, or cross-module contracts.

## 4. Backend Standards

### 4.1 Elysia Plugins

Each backend plugin should:

1. Be a named `new Elysia({ name, prefix? })` instance.
2. Declare typed dependencies with `.use()` inside the plugin that consumes them.
3. Use Elysia validation for request bodies, params, query strings, and important response contracts.
4. Keep route handlers thin.
5. Delegate business logic to services.
6. Use lifecycle hooks only for plugin-owned setup and teardown.
7. Use `as: 'global'` or `as: 'scoped'` intentionally and sparingly.

### 4.2 Services

Services should:

1. Be framework-independent where possible.
2. Receive concrete values, adapters, or small interfaces.
3. Avoid accepting Elysia `Context`.
4. Own domain invariants.
5. Be easy to unit test without starting an HTTP server.

### 4.3 Security Boundaries

Security-sensitive code should make boundaries explicit:

1. Authentication verifies identity.
2. Authorization decides allowed actions.
3. Validation rejects malformed input.
4. Services enforce domain invariants.
5. Persistence code stores canonical state.

Do not hide authorization inside UI assumptions or client-only checks.

### 4.4 Observability Boundary

New backend and frontend platform code must route logs, warnings, caught
errors, and noteworthy lifecycle events through Zero's observability boundary.

Use:

1. `OBS_CODES` for stable event codes and prefixes.
2. `emitPlatformCode()`, `warnPlatform()`, or `errorPlatform()` for backend
   and server-side events.
3. `emitFrontendCode()` for browser-side events.
4. Custom `PlatformSink` or `FrontendObservabilitySink` adapters when an app
   needs to send events elsewhere.

Avoid direct `console.*` calls in reusable platform code. Direct console output
is acceptable for:

1. Console sink adapters.
2. Browser console sink adapters.
3. Human-facing CLI presentation.
4. Temporary local debugging that is removed before completion.

When touching existing code, correct ad-hoc logging/warning/error handling if
it is in the touched responsibility area and can be routed through the
observability boundary without expanding scope.

See `docs/observability.md`.

## 5. Frontend Standards

### 5.1 SDK

SDK code should:

1. Centralize transport behavior.
2. Reuse the platform auth client for authenticated requests.
3. Keep WebSocket, HTTP, and token refresh behavior consistent.
4. Expose small ergonomic APIs instead of leaking internal clients unnecessarily.
5. Preserve type safety from schema definitions where possible.

### 5.2 Hooks

Hooks should:

1. Be SSR-safe when exported from the public frontend barrel.
2. Return stable, predictable shapes.
3. Avoid duplicating transport/auth logic that belongs in the SDK.
4. Keep optimistic state and server reconciliation clear.

### 5.3 Components

Components should:

1. Render data and interactions.
2. Use hooks/SDK APIs for data access.
3. Avoid direct `fetch()` unless the component is explicitly a low-level transport component.
4. Respect schema metadata and table primary key definitions.

## 6. Testing Standards

Tests should match intended platform contracts.

Backend tests should include:

1. Service unit tests for domain behavior.
2. Elysia `app.handle()` tests for HTTP route validation and lifecycle.
3. WebSocket integration tests for sync protocol behavior.
4. Auth and policy tests for security-sensitive paths.

Frontend tests should include:

1. SDK behavior tests for auth, refresh, sync, and storage transport.
2. Hook tests for loading, error, SSR fallback, and subscription behavior.
3. Component tests only where rendering logic or interaction complexity justifies them.

## 7. Review Checklist

Before considering a fix complete:

1. Does each changed file still have one clear responsibility?
2. Are plugin dependencies explicit?
3. Are route handlers thin enough?
4. Is authorization server-side?
5. Are public methods and exported APIs documented?
6. Are comments explaining contracts instead of narrating obvious code?
7. Are tests aligned with intended behavior?
8. Are relevant docs updated with the changed behavior?
9. Did relevant checks run?
10. Do new logs, warnings, caught errors, and lifecycle events use the
    observability boundary instead of ad-hoc `console.*`?
