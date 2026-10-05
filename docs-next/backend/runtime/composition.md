---
id: zero.runtime.composition
type: how-to
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: composition
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose An App, Then Listen

[Runtime index](./index.md) · [Documentation index](../../index.md)

Keep the server entry small. Configuration chooses systems/data paths;
`createApp` admits and composes them asynchronously; the application then opens
its listener. Do not start services as module-import side effects merely to make
a route file convenient to import.

```ts
// app/server.ts in a package-mode app
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);
app.listen(config.port);
```

This is an entry point for an already configured app whose declaration includes
`port`, not a complete scaffold. For an omitted port, obtain the default through
`resolveConfig(config).port` or choose an explicit listener port.
The public `App` type is the resolved return type of `createApp`; it is not a
second application engine to construct manually.

## What Startup Owns

Startup resolves trusted configuration and paths, admits schemas/policies,
creates independent system/application data planes, prepares resources and
identity projection, builds/loads the frontend/server modules, mounts managed
plugins and completes initialization before returning the app.

Feature activation follows the owning configuration contract, not a universal
switch rule. Guardian is disabled when auth is omitted/false. Torrent requires
auth; KV is enabled by default. AI, Vector, Email and PDF are opt-in. Domain
registrations and async setup must complete before dependent recovery or requests.

Use [declarations](../schema/tables.md) in the app's table map and explicit realm
contributions for Fabric placement. A row's tenant_id or a client table's lazy
mode does not choose a physical database.

## App-Local Services

Managed runtime bindings belong to the concrete app instance. The internal
owner holds service registrations and reverse cleanup; ordinary app code uses
the public composition/extension callbacks and service surfaces, not a private
runtime import or process-global current-app variable.

Compatibility getters may return no service when several runtimes make the
choice ambiguous. Pass the concrete app-bound dependency to background work.
See [plugins](./plugins.md) and [authority boundaries](../../concepts/service-boundaries.md).

## Failure And Shutdown

Failed creation cleans up partially constructed owned resources; it must not
publish a successful-looking app with unfinished authority or migration state.
Do not suppress startup failure and then open the listener. Diagnose the safe
configuration/domain code and failed stage.

Await app shutdown. Extension drains run while Guardian/Fabric dependencies
remain available; remaining service cleanup follows ownership. A detached timer
started by app code still needs an owned cancellation/drain path.

## Configuration And Verification

Default port is3000; the scaffold can choose a different environment-derived
value in its own trusted config. `createApp` returns the app; the entry point's
listen call supplies the actual selected port. Path defaults live in
[runtime configuration](./configuration.md#managed-directories).

For an isolated test, use synthetic config, ephemeral data, no env-file loading
and an ephemeral listener or `app.handle` when applicable. Creation can build
files, import modules and migrate managed data; it is not a static documentation
check. Never point a verification fixture at a running application's directories.

## Related Guides And Next Steps

- [Discovery](./discovery.md) explains what gets imported at startup.
- [Endpoints](./endpoints.md) adds an admitted request handler.
- [Plugins](./plugins.md) owns reusable service setup/drain.
- [Data planes](../../concepts/data-planes.md) distinguishes runtime persistence.
