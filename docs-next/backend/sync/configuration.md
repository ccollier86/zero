---
id: zero.sync.configuration
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: configuration
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

# Sync Configuration

[Sync index](./index.md) · [Documentation index](../../index.md)

There are two configuration levels. Managed createApp composes Guardian,
Resources, system data and Fabric. Standalone createSyncPlugin accepts a
SyncPluginConfig and does not silently install those managed protections.

## Managed Choices

| Setting | Meaning |
| --- | --- |
| syncAuth | Token verifier and required/public handshake policy; managed authenticated defaults are required |
| syncPolicy | Additional synchronous table/operation restrictions; cannot reopen platform denials |
| ephemeralPolicy | Custom collaboration topic classification; reserved managed topics remain protected |
| syncDefaults | Loading-mode defaults, not authorization |
| stateSync | Enable durable user-state transport; defaults false and requires authentication |

Declare app tables/resources in their owning configuration. Do not add a tenant
selector to the WebSocket URL; [Fabric binding](./tenant-sync.md) is server-derived.

## Standalone Choices

| SyncPluginConfig field | Behavior |
| --- | --- |
| db, tables | Required database configuration and server table catalog |
| reactiveDB | Inject an existing database instead of creating one |
| ownsReactiveDB | Defaults false for injection; invalid without reactiveDB; created databases are always owned |
| auth | Omission admits anonymous standalone Sync; required defaults false in standalone auth; an invalid supplied token still fails closed |
| policy | Omission permits standalone table access |
| mutationValidators | Logical validation for raw declarations; schema-generated tables already carry it |
| snapshotTables | Restrict full snapshots; omission preserves standalone readable-table behavior |
| replicaChangePolling | File default 250ms; false disables; positive safe interval minimum 10ms |
| stateSync, tenancyMode | User-state and managed identity profile |
| ephemeralPolicy | Required/fail-closed with auth; authless compatibility permits legacy topics |

systemDataPlane, stateDataPlane, tenantDataPlane, resourcePolicy and runtime are
composition seams. Prefer the managed root to assemble them; injecting only a
plane without its classification and live authority contracts is rejected.

## Authentication And Client Timing

SyncAuthConfig.getTokenVerifier is required when supplying auth.
required defaults according to the owning composition; allowLegacyQueryToken
defaults false. revalidateIntervalMs defaults 30 seconds; authority revision
polling is enabled by invalidationPollIntervalMs. Required handshake timeout is
10 seconds. Revalidation configuration does not remove synchronous commit fences.

The low-level client defaults autoConnect:true, stateSync:false,
ackTimeout:10000 and unlimited reconnect attempts. getToken reads current
credentials on connection; refreshAuth handles an authentication close;
bindAuthLifecycle coordinates resets. Exact mutation receipts additionally
default to 30000ms and accept at most 300000ms.

## Bounds

Inbound WebSocket payloads are limited to 1MiB. Outgoing buffered data is bounded
at 16MiB; snapshot chunks target at most 900KiB. Physical tenant snapshots have
additional [budgets](./tenant-sync.md). State and ephemeral quotas are listed in
their [own](./user-state.md) [guides](./ephemeral.md), because their meanings differ.
Per-socket ingress additionally bounds pending messages at 32 and pending encoded
bytes at 4MiB; the frame limit alone is not a bound on queued work.

See [client configuration](../../frontend/sdk/configuration.md),
[policies](./policies.md) and [lifecycle](./lifecycle.md).
