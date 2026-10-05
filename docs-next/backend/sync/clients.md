---
id: zero.sync.clients
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: clients
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose The Managed SDK Or Low-Level Sync

[Sync index](./index.md) · [Documentation index](../../index.md)

Most app screens should use one root createClient instance and its providers,
collections and hooks. The managed SDK owns authentication restoration, data
planes, service clients and authorization-boundary resets.

@zero/framework/sync/client is a lower-level integration for code that
deliberately owns transport/store composition.

```ts
import { createSyncClient } from '@zero/framework/sync/client';

export const sync = createSyncClient({
  url: 'ws://localhost:3000/sync',
  tables: {},
  autoConnect: false,
});
// Supply the real schema-derived client tables and auth bridge before use.
```

An empty catalog is useful for demonstrating construction, not a complete app.

## Low-Level Surface

createSyncStore/createTableSlice/createSlice and routeServerMessage use XState
stores. SyncProvider/useSyncClient/useTable/useRow/useQuery/useSyncStatus form
the corresponding React context. These similarly named hooks are not
interchangeable with root SDK hooks.

StateClient and EphemeralClient require message routing and their dedicated
stores. Low-level stateSync:true only sends the subscription; it does not
automatically wire all StateClient storage/routing.

## Ownership

Retain one client per intended connection. Dispose listeners and disconnect on
permanent shutdown; reset purges local data and reconnect opens a replacement
connection without promising a fresh scope.

Use getToken rather than a permanently captured bearer string when credentials
can change. tableSyncPlanes must match server-authored routing. A raw client
does not automatically inherit Guardian's HTTP/session bridge.

See [SDK construction](../../frontend/sdk/index.md),
[SDK low-level bindings](../../frontend/sdk/low-level-sync.md),
[mutations](./mutations.md), [authentication](./authentication.md) and
[configuration](./configuration.md).
