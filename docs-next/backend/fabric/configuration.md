---
id: zero.fabric.configuration
type: reference
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: configuration
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Fabric Configuration Reference

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric is configured on the server through `createApp`/typed app configuration.
Declarations are admitted before actor work; this reference does not authorize
loading an untrusted config module.

## Minimal Multiple Topology

This fragment assumes `appRealm` is the shared admitted realm:

```ts
import type { AppDatabaseTopologyConfig } from '@zero/framework/server';

export const databaseTopology = {
  mode: 'multiple',
  rootDirectory: './data/realms',
  realm: appRealm,
  actors: { launch: { kind: 'source', entrypoint: new URL('./server.ts', import.meta.url) } },
  tenantIsolation: 'tenant-database',
  placement: 'file',
} satisfies AppDatabaseTopologyConfig;
```

Multi-tenant Guardian and schema-identical realm/app table declarations are
additional prerequisites. Source entrypoints resolve to absolute paths; the
private root must not overlap app/system/storage/output or fence artifacts.

## Mode And Placement

| Setting | Default/admission |
| --- | --- |
| `mode` | single when omitted; multiple requires rootDirectory, realm, actors |
| `tenantIsolation` | shared-row; tenant-database requires multi-tenant Guardian |
| `placement` | file; hot shorthand on-write + 64 MiB per database |
| explicit `placement.default` | required file/hot |
| `placement.select` | optional synchronous opaque-ref callback; requires hot config |
| `placement.hot.maxBytes` | required positive safe integer for explicit hot |
| `placement.hot.durability` | on-write; also periodic/final |
| periodic `snapshotIntervalMs` | 30000; portable positive timer |
| periodic `snapshotTimeoutMs` | derived from interval; admitted bounded watchdog |

Cadence/watchdog fields are valid only for periodic durability. Placement is
captured and pinned across replacement; config mutation is not a live switch.

## Actors And SQLite

`actors.launch` selects source, bundle or reviewed command-prefix.
`actors.env` defaults empty and is the entire credential allowlist.
Executor policy defaults: maxInFlight64; startupTimeoutMs5000;
operationTimeoutMs30000; shutdownAckTimeoutMs5000; shutdownExitTimeoutMs5000;
sigtermTimeoutMs2000; sigkillTimeoutMs2000. All intervals must be positive safe
integers within the portable timer ceiling.

`sqlite` selects actor-safe tuning, not raw handles or arbitrary PRAGMA strings.
Actor admission validates its own supported fields/bounds; standalone persistence
settings are not all interchangeable. In particular, an actor buffer pool size
is positive; the standalone zero-retained-buffer option is not automatically
valid actor configuration.

| sqlite field | Default when omitted | Actor admission |
| --- | --- | --- |
| cacheSize | -262144 | safe integer; SQLite positive pages/negative KiB semantics |
| mmapSize | 1073741824 | non-negative safe integer |
| walAutocheckpoint | 1000 | positive safe integer |
| pageSize | 4096 | positive safe integer; actual SQLite opening remains authoritative |
| synchronous | NORMAL | OFF/NORMAL/FULL/EXTRA |
| tempStore | MEMORY | DEFAULT/FILE/MEMORY |
| busyTimeout | 5000 | positive safe integer |
| statementCacheSize | 1000 | positive safe integer |
| bufferPool | enabled | false or maxPoolSize/preallocate object |
| bufferPool.maxPoolSize | 100 | positive safe integer |
| bufferPool.preallocate | true | boolean |
| ringBufferDepth | 1000 | positive safe integer |

Actor persistence telemetry is disabled locally; managed parent database
observability owns the operational boundary. These settings are not arbitrary
PRAGMA commands or a native connection escape hatch.

## Capacity And Restart

See the complete [capacity matrix](./capacity.md). Readers default true.
Idle sweep defaults to a derived cadence (ceil idle timeout/2, clamped
1000–30000ms); `false` disables automatic sweeps.

Restart defaults: `initialDelayMs: 10`, `maxDelayMs: 1000`,
`circuitFailureThreshold: 5`, `circuitCooldownMs: 5000`.
Threshold is at least2; initial≤max; cooldown≥max.
Invalid/unknown settings fail admission instead of being silently ignored.

## Read Time And Projection

Topology/realm/launch/env/limits are detached server setup policy. They are not
client secrets, per-request mutable selectors, or a replacement for the live
Guardian capability. Doctor can validate admitted configuration, but loading a
trusted config module executes its code.

See [topology](./topology.md), [actors](./actors.md),
[placement](./placement.md) and
[platform data modes](../configuration/data-modes.md).
