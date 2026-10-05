---
id: zero.frontend.runtime.sync-provider
type: reference
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: sync-provider
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, advanced low-level Sync]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Low-Level Sync Context

[Runtime index](./index.md) · [Documentation index](../../index.md)

SyncProvider exposes a SyncClient and optional state/ephemeral peers to low-level
Sync hooks. AppProvider already supplies a SyncProvider using its integrated
SDK client. Most application components should consume the normal app hooks
instead of creating another low-level socket.

## Public Import And Composition

```tsx
import { SyncProvider, useSyncClient } from '@zero/framework/sync/client';

// Advanced UI fragment: syncClient is a caller-owned, configured SyncClient.
<SyncProvider client={syncClient}>{children}</SyncProvider>;
```

Alternatively, supply url and tables to create a provider-owned low-level client.
The URL is WebSocket, unlike AppProvider's HTTP server URL. The table definitions
are ClientTableDef shapes. Token/getToken/refreshAuth/bindAuthLifecycle are
explicit low-level auth inputs, not an implicit Guardian session derived from
rendering the provider. Exact forwarded props are in [configuration](./configuration.md#low-level-syncprovider-props).

## Context And Ownership

The context contains syncClient, nullable stateClient and nullable ephemeralClient.
Supplying an existing client retains caller ownership and optional supplied peers.
Creating a new client from url/tables creates no StateClient or EphemeralClient;
those capabilities do not appear merely because the hook names are exported.

The first context value is retained. A provider-owned client is disconnected
on unmount; a caller-owned client is not disconnected by this provider. The
normal low-level createSyncClient connection policy still applies. Rerendering
with new props is not a live ownership/token replacement API.

useSyncClient throws when no SyncProvider exists. Other low-level hooks have
their own fallback/return contracts; similarly named useRow/useQuery hooks from
the app SDK are not interchangeable imports. Do not infer that a SyncProvider
alone creates ClientProvider or enables every integrated platform service.

## Authority And Verification

The server enforces token, resource, tenant/realm, read-only and live revocation
policy. A table definition or supplied client never selects another tenant's
authority. When integrating a nonstandard/native auth client, wire its supported
token refresh and scope lifecycle instead of bypassing the server's checks.

Check there is one intended socket/store, an owned connection disconnects on
unmount, an externally owned connection survives provider unmount and authenticated
scope replacement resets the expected local state. These are isolated source
contracts, not a verified simultaneous-independent-client architecture.

## Related Guides And Next Steps

- [AppProvider](./app-provider.md) normally composes this layer automatically.
- [ClientProvider](./client-provider.md) exposes the separate integrated SDK context.
- [Configuration](./configuration.md) distinguishes HTTP and WebSocket inputs.
- [Scope boundary](./authorization-scope-boundary.md) protects custom data presentation.
