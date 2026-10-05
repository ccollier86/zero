---
id: zero.frontend.runtime
type: index
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: overview
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Frontend Runtime And Providers

[Frontend index](../index.md) · [Documentation index](../../index.md)

The runtime connects one browser client to React, the router, Sync and modal
presentation. Server rendering supplies safe initial UI without opening a browser
transport. Hydration installs the app's route modules and provider context; live
authority still comes from the server.

## Choose Your Entrance

- [AppProvider](./app-provider.md): the normal root composition for a Zero app.
- [ClientProvider](./client-provider.md): explicit client context and SSR-safe access.
- [SyncProvider](./sync-provider.md): advanced low-level Sync context/ownership.
- [Authorization scope boundary](./authorization-scope-boundary.md): cache partitions
  and retained-callback guards for identity, tenant and authority changes.
- [Scope transitions](./scope-transitions.md): how stale UI/loader data is masked
  and reloaded without exposing an old organization's data.
- [Hydration](./hydration.md): generated route manifests and the advanced public runtime.
- [Error boundaries](./error-boundaries.md): render error/not-found presentation.
- [Configuration](./configuration.md): exact provider props, defaults and timing.
- [Roadmap](./roadmap.md): relevant future direction, not current runtime APIs.

Theme and notification providers are optional composition, not automatically
installed by AppProvider. The client-facing SDK and file router own their
respective API/navigation semantics; these pages own provider wiring.

## Integration And Modes

Server [runtime composition](../../backend/runtime/composition.md) exposes
server-authored routing/loading metadata. [Schema tables](../../backend/schema/tables.md)
provide safe client shapes; Guardian supplies live identity/permissions. The same
frontend provider pattern applies to single/multi tenancy and single/Fabric
application data planes; those backend modes cannot be selected by changing
a browser table selector or client cache key.

The observed design favors a shared transport, explicit ownership, SSR-safe
fallbacks and synchronous scope masking. It is not a general guarantee that
several independent browser clients can be alive concurrently.
