---
id: zero.reactive-db.change-history
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: change-history
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Replay A Durable Ordered Change History

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

Every tracked mutation receives a database-wide monotonic seq and
durable Change record in the row transaction. The retained log is bounded;
it is not a permanent business audit trail.

## Cursor APIs

`currentSeq` reads the durable head. `syncEpoch` is the instance's process-unique
Sync epoch used to reject incompatible pre-restart client cursors. They serve
different purposes; epoch is not a database transaction version.

`getChangesAfter(seq)` accepts a nonnegative safe integer and returns canonical
changes or null when incremental history cannot safely be represented.
Retention/continuity and incompatible row-format gaps require a full snapshot.
Invalid durable state/schema can throw and invalidate serving.

The instance's advanced transport primitive `getChangesPageAfter(seq,limit)`
returns changes/headSeq/hasMore or null, with limit 1–1000. It is documented as
an internal Fabric transport primitive despite being visible on the exported
class; normal app replay should use the supported higher-level Sync/data surface.

## Retention And Reset

`ringBufferDepth` defaults to 1000. Pruning never resets/reuses the durable
sequence. `clearChangesOnStart:true` is a destructive stop-all maintenance
escape hatch, not a migration workaround or a normal development reset.

When a client misses the retained window, fetch an authoritative scoped snapshot.
Do not advance its cursor while keeping unknown stale cached rows. Increasing
retention later cannot reconstruct history already pruned.

## Change Payload

Changes carry canonical post/previous rows, a string rowId, op and timestamp.
Local/external delivery metadata is process-local and not a durable origin token.
The complete batch is decoded before successful replay, so corrupt format must
not produce a partially trusted result.

Log objects/triggers/state are protected infrastructure. Raw SQL edits to them
are not a supported recovery API.

## Verify

Check monotonically ordered writes across connections, rollback sequence/log
behavior, retention boundaries, cursor validation and incompatible/corrupt replay.
Separate permanent audit needs from reconnect history.

## Related Guides And Next Steps

- [Snapshots](./snapshots.md) supplies the fresh baseline after a gap.
- [Replica delivery](./replica-delivery.md) consumes history without silent skips.
- [Subscriptions](./subscriptions.md) owns local event delivery.
- [Configuration](./configuration.md) lists retention/readiness settings.
