---
id: zero.frontend.state.server-state
type: reference
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-server-state
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Server-Persisted User JSON State

[State index](./index.md) · [Documentation index](../../index.md)

```tsx
import { useServerState, useServerStateReady } from '@zero/framework/react';

const [sidebarOpen, setSidebarOpen] = useServerState('sidebar.open', true);
const stateReady = useServerStateReady();
```

This React fragment requires the configured provider/state Sync described in
[configuration](./configuration.md). Keys and values are JSON-safe UI/application
state. The hook returns [value,setValue], not an acknowledged write promise.

Reads are local @xstate/store subscriptions; writes apply optimistically and send
state protocol messages. State snapshot/change delivery synchronizes the server's
current user principal across devices. Multi-tenant identity is server-derived
organization+user; a caller cannot select another user's persisted namespace.

StateClient is public on the advanced Sync client surface and available through
the integrated client's state wiring. It exposes set/delete/clear, get/getAll/
getByPrefix, key/global subscription and readiness/lifecycle integration.
clear deletes state for the current admitted principal, not every user.
GetAll/prefix results are shallow prototype-free dictionaries; do not assume
deep immutable application objects from them.

useServerStateReady returns false during SSR/transition and before the snapshot.
Use it to avoid initializing durable state from fallback prematurely. A default
is read fallback, not a server insert or recurring reset-on-prop-change command.

Scope replacement freezes writes and purges old values; retained setters fail
closed. Unauthenticated/missing context is not a fabricated user store.
Sync disconnection/optimistic UI does not establish durable acceptance.
Do not store service credentials or unbounded/private datasets simply because
the API accepts JSON.

## Verification

Check first snapshot, defaults, cross-device changes, optimistic rejection/
reconnect, same user across organizations and retained setters during transitions.
State is not an app table, general cache or distributed transaction.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns provider prerequisites.
- [Drafts](./form-drafts.md) supplies convenience naming/helpers.
- [Ephemeral](./ephemeral.md) is the RAM-only alternative.
- [Low-level Sync](../sdk/low-level-sync.md) owns explicit store/client composition.
