---
id: zero.vector.operations
type: operations
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: operations
maturity: supported
applies_to: ["2.1.1 baseline with unreleased scope/capacity corrections"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Vector Status, Capacity And Shutdown

[Vector index](./index.md) · [Documentation index](../../index.md)

list/listIndexes return sorted configured names without opening indexes.
stats/status/getStatus returns index, local path, dimensions, documentCount
and indexCompleteness for one/all indexes. Stats can open collections.

Paths are privileged diagnostics. An app-facing status endpoint should project
only explicitly admitted fields rather than returning the raw object.

## Optimization

optimize(index) performs native optimization under that index's write boundary;
optimize() runs configured indexes independently. It is explicit maintenance,
not an automatic per-request requirement or a distributed server operation.

## Capacity And Failure Progress

One service admits at most 1024 active operations, including reads and queued
writes; one index admits at most 128 pending writes. Saturation returns a
value-free VECTOR_BACKPRESSURE with index/service capacity category.
Upsert admission checks capacity before copying caller records.

These fixed internal counts do not bound input bytes, record count or full process
RSS. App endpoints must choose their own appropriate payload/authorization limits.
Failed work releases capacity and does not strand later queued operations;
idle per-index queue entries retire.

## Disposal

Await dispose before releasing the owning runtime. New work is rejected,
already admitted reads/writes settle, then stores close. This is not cancellation
of native work already executing. Independent indexes remain concurrent.

See [composition](./composition.md), [scopes](./scopes.md),
[adapters](./adapters.md), [errors](./errors.md) and
[runtime shutdown](../runtime/shutdown.md).
