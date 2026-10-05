---
id: zero.sync.user-state
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: user-state
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

# Durable Scoped User State

[Sync index](./index.md) · [Documentation index](../../index.md)

State Sync stores small JSON values for the authenticated user's current scope.
It is useful for preferences and resumable UI progress across devices. It is
not KV, a shared tenant table, a secret store or Torrent's per-run memory.

## Ownership And API

Managed stateSync defaults false and requires auth when enabled. StateManager
owns persisted server data; state.subscribe establishes a snapshot, followed by
state.set/delete/clear and acknowledgments. The server derives identity from
current authorization, not a user ID in a message.

The client StateClient API has local get/getAll/getByPrefix/size/ready,
set/delete/clear, and key/global subscriptions. Writes are optimistic; their
void return is not an exact mutation receipt promise. Read ready before treating
the initial local default as restored durable state.

## Limits

| Bound | Value |
| --- | --- |
| Value | 65536 UTF-8 JSON bytes |
| Keys per user scope | 1000 |
| Key length | 256 characters |
| Total | 10485760 bytes (10MiB) |

State errors distinguish invalid request, oversized values, too many keys,
long keys, total-size quota and unauthorized access. On a scope transition,
cached state is purged and writes are frozen until the new baseline.

## Choose The Right Store

Use an app schema for relational/queryable records and shared organizational
ownership. Use [KV](../kv/index.md) for service-owned counters/cache/limiter
state. Use [ephemeral topics](./ephemeral.md) for presence. Use
[Torrent memory](../torrent/index.md) for durable workflow execution state.

See [frontend state](../../frontend/state/index.md),
[configuration](./configuration.md), [data planes](./data-planes.md) and
[Guardian scope](../guardian/index.md).
