---
id: zero.fabric.placement
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: placement
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

# File, Hot And Hybrid Placement

[Fabric index](./index.md) · [Documentation index](../../index.md)

Placement selects execution/storage behavior for an opaque database ref.
It does not change Guardian permissions, realm schema or tenant identity.

## File And Hot

`placement: 'file'` is the default: file-backed SQLite with managed WAL and
optional read actors.
`placement: 'hot'` is bounded shorthand for RAM-active execution with
on-write durability and a 64 MiB per-database image limit.

For an explicit policy, `default` is required and `hot.maxBytes` is a positive
safe integer whenever hot is possible. The selector is synchronous; async
selectors and invalid results fail closed.

## Hybrid Example

```ts
import { createNamedDatabaseRef } from '@zero/framework/server';
import type { AppDatabasePlacementConfig } from '@zero/framework/server';

const fastRef = createNamedDatabaseRef('fast-working-set');
export const placement = {
  default: 'file',
  select: ({ databaseRef }) => databaseRef === fastRef ? 'hot' : 'file',
  hot: { maxBytes: 32 * 1024 * 1024, durability: 'on-write' },
} satisfies AppDatabasePlacementConfig;
```

This is trusted deployment configuration, not a per-request callback. Selection
is pinned to the coordinator entry across replacement. Supplying any selector
requires a valid hot policy even if the author believes it only returns file.

## Hot Durability

- `on-write` (default): publish the configured recovery image at the managed
  write durability boundary.
- `periodic`: acknowledged writes may precede publication; a bounded cadence
  and fatal watchdog supervise snapshots.
- `final`: final lifecycle publication is the durability strategy; crash loss
  before that publication is an explicit operational tradeoff.

Periodic cadence defaults to 30000ms. Timeout is derived from cadence and
validated against exported portable minimum/maximum bounds. Cadence/timeout
options are valid only for periodic durability.

`maxBytes` is not a cap on entire process RSS. Recovery images, queues,
receipt results, native caches and other actors still consume resources.
No setting turns a private RAM image into a multi-process shared memory DB.

See [configuration](./configuration.md), [recovery](./recovery.md) and
[hot persistence](../persistence/hot-snapshots.md).
