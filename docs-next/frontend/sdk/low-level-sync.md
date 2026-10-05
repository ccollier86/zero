---
id: zero.frontend.sdk.low-level-sync
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: low-level-sync
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

# Low-Level Sync Is An Advanced Separate Surface

[SDK index](./index.md) · [Documentation index](../../index.md)

@zero/framework/sync/client exposes low-level Sync construction/store/provider/
hooks. Normal app code uses @zero/framework/react's integrated client instead:
the similarly named useRow/useQuery hooks are different exports/contracts.

SyncProvider/useSyncClient/useTable/useRow/useQuery/useSyncStatus consume the
Sync context. The provider accepts an existing client or creates one from
url+tables; its complete [runtime guide](../runtime/sync-provider.md) owns the
props/auth/lifecycle distinction. Avoid opening a duplicate socket.

```tsx
import { useTable, useSyncStatus } from '@zero/framework/sync/client';

const table = useTable<Task>('tasks');
const status = useSyncStatus();
```

This advanced fragment assumes an admitted SyncProvider and Task declaration.
useTable exposes table rows/map plus direct optimistic operations; useRow/useQuery
read the low-level store. Exact options/results must follow that surface, not the
integrated CollectionResult interface. useSyncStatus reports connection/pending;
it is not complete Guardian/Fabric readiness.

createSyncClient, SyncClientConfig, SyncClient, SyncStoreContext and createSyncStore/
routeServerMessage are advanced transport/store facilities. StateClient and
EphemeralClient integrate extension messages; their corresponding stores/hooks
are explicit composition pieces, not configured automatically by creating a raw
SyncClient. [State](../state/index.md) explains normal managed usage.

Resolved tables and plane maps are server-authored descriptive metadata.
Standalone plugin/provider composition must deliberately supply authentication,
resource/read/write policy and lifecycle adapters. Raw tables/store/sendRaw APIs
do not infer managed Guardian policy.

Sync identity/epoch/cursors and optimistic receipts are separate from UI display.
State-store subscriptions use @xstate/store under Zero's own SDK/hooks.
A reset purges local data; disconnect releases the client. Cancellation of an
acknowledgment wait cannot undo an accepted mutation.

## Verification

The [backend clients guide](../../backend/sync/clients.md) links protocol/authority
requirements. [Sync lifecycle](../../backend/sync/lifecycle.md) owns actual socket
cleanup/revocation, not merely UI unmount.

Qualify raw construction/provider mode separately from integrated app use:
handshake/refresh/reconnect, snapshot/catch-up, receipts, scope reset and dispose.
Source helper availability is not an installed package or app authorization claim.

## Related Guides And Next Steps

- [Runtime SyncProvider](../runtime/sync-provider.md) owns advanced provider options.
- [Collections](./collections.md) is the normal ergonomic data path.
- [Acknowledged mutations](./acknowledged-mutations.md) owns receipt outcomes.
- [State](../state/index.md) owns extension state semantics.
