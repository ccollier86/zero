---
id: zero.runtime.plugins
type: how-to
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: plugins
maturity: supported
applies_to: ["2.5.0 development source; publication qualification pending"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# App-Local Plugin Setup

[Runtime index](./index.md) · [Documentation index](../../index.md)

Use `defineZeroPlugin({ name, setup })` to compose a reusable app-owned Elysia
plugin with Zero's concrete setup services. The compiler creates a named child
route plugin and awaits setup. Return a child Elysia plugin or mutate the supplied
app and return void.

```ts
// server/plugins/example.ts
import { defineZeroPlugin } from '@zero/framework/server';

export default defineZeroPlugin({
  name: 'example',
  setup({ app }) {
    return app.get('/api/example/health', () => ({ ok: true }));
  },
});
```

This raw health route is intentionally public and contains no protected data.
For authenticated/permission-aware domain routes, prefer [endpoint/router
declarations](./endpoints.md) or explicitly enforce the raw route's policy.

## Setup Is Not A Request

`setup` receives `{ app, zero }`; zero is the trusted app-local setup service
surface. It can supply dependencies to a domain service. It must not be copied
into every request as if it were already tenant-scoped.

The 2.5.0 build contract also supplies readonly `projectRoot`, `appDir`,
`appIdentity`, `generatedDir`, plugin-private `files`, actual resolved `frontend`
and app-bound `emitCode`. Use the declared frontend manifest instead of guessing
hashed asset paths. See [native build contributions](./build-contributions.md)
for optional `build.prepare`, public/private files and shared public SSR.

Request handlers receive a different projected service view. Multi-tenant raw
services are blocked unless code deliberately uses the unsafe boundary; strict
machine/background projections contain no unsafe bag. Those distinctions are
described in [service boundaries](../../concepts/service-boundaries.md).

## Layer Responsibilities

Give Elysia plugins stable names and explicit `.use()` dependencies. Keep
validation, hooks, routing and lifecycle in the plugin; keep business behavior
in a framework-independent service with narrow injected dependencies. Stores
own persistence, SDKs own transport/auth reuse, hooks own reactive subscriptions
and components own rendering/interaction.

Async setup should finish before readiness/publication. Do not start a detached
promise and return a ready plugin while its handler registry or required schema
is still empty. Startup/recovery ordering is part of the containing feature's
contract, not a timing assumption.

## Owned Cleanup

An extension's async onStop drain is awaited while managed Guardian/Fabric
services remain available. Stop intake, cancel cooperative background work and
await required commits before returning. The framework then disposes its owned
services and remaining hooks; app code must release its own timers/subscriptions.

Do not call shutdown dependencies after the drain has completed or capture a
process-global replacement service. A failed setup callback must not leave
partially published service state or scheduled work behind.

## Public Composition Helpers

`createServerExtensionApp` resolves an explicit extension array asynchronously.
`createServerExtensionBundle` returns a mountable callback.
`applyServerExtension` applies one definition/raw plugin with inherited policy
and an optional app-local runtime binding. Shape/kind guards classify supported
definitions and raw plugin forms. These are advanced trusted composition APIs,
not a supported untrusted dynamic module loader.

## Related Guides And Next Steps

- [Composition](./composition.md) owns app startup/listening.
- [Discovery](./discovery.md) explains module exports and load order.
- [Build contributions](./build-contributions.md) compiles optional package content before runtime setup.
- [Middleware](./middleware.md) adds cross-cutting request behavior.
- [Configuration](./configuration.md#plugin-options) lists setup options.
