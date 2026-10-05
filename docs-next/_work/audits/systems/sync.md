---
id: zero.inventory.sync
type: inventory
audience: [maintainer, agent]
owner: sync
status: in-review
visibility: internal
system: sync
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Realtime Sync, Durable User State And Ephemeral Topics Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Owns authenticated WebSocket transport, policy-filtered snapshots/replay/live changes, acknowledged mutations, durable user state, ephemeral collaboration topics, and the low-level client stores/hooks. ReactiveDB owns data changes; Sync owns delivery and client protocol.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

Sync is Zero's realtime transport and reconciliation layer. A **data plane** has
its own epoch/sequence/change log; a **snapshot** establishes client state and a
**catch-up** replays later admitted changes. **Durable user state** persists in
the system plane, while **ephemeral topics** are bounded in-memory collaboration
state. Neither is KV or Torrent scratch memory.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Connection/auth lifecycle | createSyncPlugin, SyncAuthConfig, first `sync.auth`/`sync.auth.ready` handshake | Stable Bun raw socket identity, async admission/lifecycle fences/revalidation | [Draft guide](../../../backend/sync/authentication.md) |
| Subscription/snapshots | sync.subscribe; explicit snapshot tables, full/lazy/auto eligible modes | Per-plane consistent snapshots, policy read filters, backpressure bounds | [Draft guide](../../../backend/sync/snapshots.md) |
| Catch-up and live changes | sync.change/catchup; per-plane sequence/epoch recovery | Pruned/invalid cursor requires new snapshot, current row policy on delivery | [Draft guide](../../../backend/sync/reconnect.md) |
| Client mutations/receipts | `sync.mutate`/ack; legacy void mutations plus `SyncClient.insertAsync/updateAsync/deleteAsync` and `Collection.insertAsync/updateAsync/removeAsync` | Exact mutation-ref/server acknowledgement, normalized rejection, bounded timeout/signal; optimistic changes reconcile | [Draft guide](../../../backend/sync/mutations.md) |
| Server policy | SyncPolicy read/mutate/insert/update/delete, default composition | Managed platform tables protected; app deny-wins; standalone default allowAll | [Draft guide](../../../backend/sync/policies.md) |
| Lazy HTTP data | Managed internal `createDataQueryPlugin` mounts `/api/data`; client SDK/DataTable source consume the route | Resource policy, validated field filters/order/page, max limits; query vs shared cache | [Draft guide](../../../backend/sync/lazy-data.md) |
| Multiplexed data planes | default/system/tenant, SyncDataPlaneName | Independent log identities multiplexed, no global shared sequence assumption | [Draft guide](../../../backend/sync/data-planes.md) |
| Physical tenant Sync | Auth-derived persistent capabilities, bounded paged snapshots/replay | Fabric file isolation/current membership fences across each result/commit | [Draft guide](../../../backend/sync/tenant-sync.md) |
| Durable user state | StateManager, state.subscribe/set/delete/clear; JSON state and ack | System-plane user identity keys, concurrent durable changes and user-only delivery | [Draft guide](../../../backend/sync/user-state.md) |
| Ephemeral topics | EphemeralStateManager/Channel, subscribe/set/delete, TTL/presence/typing | RAM-only collaboration, ownership, namespace policy, disconnect cleanup | [Draft guide](../../../backend/sync/ephemeral.md) |
| Managed topic policy | createManagedEphemeralTopicPolicy, explicit custom ephemeralPolicy | Room-membership presence/typing and current user topics; unclassified deny | [Draft guide](../../../backend/sync/ephemeral-policy.md) |
| Low-level clients/hooks | @zero/framework/sync/client, createSyncClient, store/collection/state/ephemeral hooks | React/XState store adapters separate from SDK auth/restoration surface | [Draft guide](../../../backend/sync/clients.md) |
| Operational lifecycle | Close/drain/dispose, authority single-flight and timer cleanup | Closed/disposed promises cannot reactivate sockets; revocation invalidates scope | [Draft guide](../../../backend/sync/lifecycle.md) |

## Public Surface Map

- `@zero/framework/sync` exports server ReactiveDB and Sync plugin/policy/state/
  ephemeral APIs, protocol/config types, identity helpers, and mutation receipt
  errors/constants/types.
- `@zero/framework/sync/client` exports `createSyncClient`, stores/slices,
  React provider/hooks, durable `StateClient` and hooks, and
  `EphemeralClient` and hooks. `/sync/identity` and `/sync/types` are focused
  identity and protocol/type subpaths.
- The client-safe root `@zero/framework` exports `Client`, `Collection`,
  `createClient`, and collection/data hooks. `createDataQueryPlugin` is mounted
  by managed server composition and is not a named public package export.
- Existing void client and Collection mutations remain compatible. Additive
  async counterparts await the exact server ack; rejection, timeout,
  disconnect/reset, or scope replacement rejects a normalized
  `SyncMutationError`. Caller abort stops waiting but cannot roll back a write
  already committed by the server.
- Low-level `createSyncPlugin` can be authless/allow-all. Managed `createApp`
  additionally composes Guardian, Resource/platform protections, physical
  tenant capabilities, and client authorization resets; their defaults differ.

## Configuration Inventory

Managed AppConfig syncAuth required with auth, public without; explicit syncPolicy/ephemeralPolicy and syncDefaults configure protection/loading. Standalone SyncPluginConfig accepts db/tables/policy/auth/replica polling/runtime, injected reactiveDB + ownsReactiveDB defaultfalse, optional state/system/tenant plane dependencies. File-backed replica polling auto250ms; explicit false disables; positive interval clamped minimum10ms. raw SDK/client auth/autoConnect/snapshot/reconnect options belong frontend-sdk inventory. stateSync defaultfalse requires auth. Ephemeral cleanup default5000ms; payload/TTL/quota limits are EPHEMERAL_LIMITS, durable state uses STATE_LIMITS. Each limit needs exact field documentation, not a blanket unbounded promise.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

ReactiveDB commits are source events; ordinary listeners are synchronous and the transport controls asynchronous delivery. Managed server platform policies protect system rows and apply owner/member filters. Guardian restoration/tenant switch bumps authorization boundary and clears stale client data. File-backed replicas tail durable history, not an external message broker. Ephemeral topics use server-derived namespaces and room membership; do not imply SQL durability or multi-host external pubsub. Standalone plugin can be authless and allow-all, so app factory defaults must be taught separately.

## Evidence And Verification

Implementation and all four Sync package entry points were inspected. The Sync
directory contains 42 test files and the low-level client directory contains
seven; receipt-specific and real-socket integration tests are present but were
not run in this documentation pass.

- [src/sync/index.ts](../../../../src/sync/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/types.ts](../../../../src/sync/types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/sync.plugin.ts](../../../../src/sync/sync.plugin.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/sync-plugin-config.ts](../../../../src/sync/sync-plugin-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/sync-socket-controller.ts](../../../../src/sync/sync-socket-controller.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/sync-socket-auth.ts](../../../../src/sync/sync-socket-auth.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/data-query.plugin.ts](../../../../src/sync/data-query.plugin.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/state-manager.ts](../../../../src/sync/state-manager.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/ephemeral-managed-policy.ts](../../../../src/sync/ephemeral-managed-policy.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/ephemeral-validation.ts](../../../../src/sync/ephemeral-validation.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/client/sync-mutation-receipts.ts](../../../../src/sync/client/sync-mutation-receipts.ts): exact acknowledgement waiter, safe errors, timeout/signal policy.
- [src/sync/client/sync-client.test.ts](../../../../src/sync/client/sync-client.test.ts): acknowledgement/rejection/reset/scope/disconnect tests present, not executed.
- [src/frontend/client/collection.test.ts](../../../../src/frontend/client/collection.test.ts): Collection async mutation tests present, not executed.
- [src/sync/sync-auth.integration.test.ts](../../../../src/sync/sync-auth.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/state-cross-runtime.integration.test.ts](../../../../src/sync/state-cross-runtime.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/multi-database-sync.integration.test.ts](../../../../src/frontend/server/multi-database-sync.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/state-sync.md](../../../../docs/state-sync.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Snapshots are explicit and loading mode is not permission. Server-paginated query ordered IDs must not merge every cached row into a result page. Durable user state, KV/cache, ephemeral topic state and workflow scratch memory are distinct stores with different lifetimes/authority. Socket identity/disconnect race fixes require real-socket tests during qualification; filenames alone not proof.

## Known Future Plans

User proposes server-side trigger actions and workflow resume; current database-automations is the owning feature. A future external messaging/event bus is separate from current in-process/replica Sync.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/sync/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [ ] Whole-platform reconciliation complete.
- [ ] Important examples and artifact/package support qualified.
- [x] First-draft guides exist and are linked; accuracy/package gates remain open.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
