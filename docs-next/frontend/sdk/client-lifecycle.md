---
id: zero.frontend.sdk.client-lifecycle
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: client-lifecycle
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, standalone client]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# One Integrated Browser Client

[SDK index](./index.md) · [Documentation index](../../index.md)

AppProvider normally creates/reuses the client. Advanced vanilla/explicit React
composition can use createClient/getClient from @zero/framework/react directly.
The SDK maintains one active singleton, not a general pool of independently
isolated clients.

## Create Deliberately

```ts
import { createClient } from '@zero/framework/react';
import { tasks } from './db/schema';

// Standalone browser fragment; don't duplicate AppProvider's creation.
const client = createClient({
  url: 'http://localhost:3000', tables: { tasks },
  auth: true, autoConnect: false,
});
client.connect();
```

This fragment needs a matching running auth-enabled server and the app's shared
table declaration. Tables can be raw client definitions or defineTable results.
A multi-table schema uses tables: schemaBundle.clientTables, not schema: schemaBundle.
Server secrets, SQLite handles and arbitrary privileged services never belong
in this browser configuration.

createClient throws when an active singleton already exists. getClient returns
that client or null; it does not create it. Normal React code reads context through
[ClientProvider](../runtime/client-provider.md), not a new client per render.

## Lifecycle Members

| Member | Contract |
| --- | --- |
| url | configured server URL |
| connected | current Sync connection state, not proof of all authority/data readiness |
| connect() | marks Sync started and begins its connection lifecycle |
| onConnectionChange(callback) | observes changes in connected; returns unsubscribe |
| onMutationRejected(callback) | subscribes to rejected/rolled-back realtime mutations; returns unsubscribe |
| disconnect() | deliberate integrated teardown; cancels scoped work, disconnects Sync, disposes auth/state/ephemeral and clears facade caches/singleton |

After integrated disconnect the object is no longer a normal reusable live
application client. Recreate it deliberately if starting a replacement app/client;
do not reconnect an auth controller that teardown already disposed. Existing
client/provider ownership needs to agree before teardown.

## Auth And Platform Peers

Auth and State Sync default false. State Sync requires auth. Auth-enabled clients
coordinate ordinary JSON/Eden/SDK calls with AuthClient token restoration, refresh,
authorization hints and scope transitions. StateClient is optional; an ephemeral
peer is constructed by the integrated client. Relevant framework-owned tables
are routed on the system plane, separate from application/Fabric table routing.

Readonly service facades include applicationAdmin, platformAdmin, apiKeys, audit,
dataRealm, dataStudio and storageStudio as supported by their backend capability
and authority. A method/property existing does not grant access or enable a
disabled server service. Do not use InternalClient transport fields as an app
escape hatch or synthesize another browser session for machine access.

## Scope And Recovery

Login/logout, tenant replacement and same-scope authorization invalidation fence
requests, stores and service caches. Ordinary token refresh preserves the semantic
identity/scope while refreshing transports. Relevant pending work is cancelled
or rejected rather than allowing an old tenant's result into the new client state.
AppProvider additionally protects SSR loader data; a standalone client consumer
must compose the appropriate [boundary](../runtime/authorization-scope-boundary.md).

Connection callbacks do not imply durable writes succeeded. Use exact receipts
or policy-aware HTTP operations for accepted mutations. A network connection can
exist while protected requests or data-plane readiness remain unavailable.

## Verification And Compatibility

Test intentional creation, a second-creation rejection, deferred connect,
subscriptions/unsubscribe, teardown and fresh recreation with synthetic data.
For auth/Fabric apps, also exercise scope replacement during a pending request.
The focused SDK tests support the inspected lifecycle; artifact qualification
must verify the installed public exports and app's normal bundled composition.

Existing calls retain their public names. Mode selection belongs to server
configuration; refreshing a singleton or changing client table metadata is not
a migration from single tenancy to Fabric.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists construction defaults.
- [AppProvider](../runtime/app-provider.md) owns normal React composition.
- [HTTP](./http.md) and [typed API](./typed-api.md) own authenticated requests.
- [Acknowledged mutations](./acknowledged-mutations.md) owns accepted realtime writes.
