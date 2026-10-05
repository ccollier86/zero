---
id: zero.observability.store
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: bounded-recent-event-store
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, frontend]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Recent In-Memory Event Store

[Observability index](./index.md) · [Documentation index](../../index.md)

MemoryEventStore retains the newest finite number of events in RAM. Default
maxEvents1000; the corrected development constructor requires a positive safe
integer, rejecting NaN/Infinity/nonpositive/fractional/unsafe values with
ObservabilityConfigurationError (OBSERVABILITY_CONFIG_INVALID).

emit stores the event; when capacity is exceeded oldest events are pruned.
clear removes current retained events. This is not a disk-backed log database,
a replay queue or independently owned immutable audit archive.

## Queries And Cursor Meaning

query accepts level (one/array), category/code/source exact matches, since
(epoch milliseconds), cursor (sequence-exclusive) and limit.
The result has events/count/nextCursor. Limit defaults100 and is bounded1–1000.

Filters run against retained records, then the **newest matching tail** up to
limit is returned, in oldest-to-newest order. A cursor requests sequences after
that value, but if more than limit new matches exist, this store returns the
most recent tail, not a guaranteed contiguous next-page history.
count is returned-item count, not lifetime/exact total. nextCursor is the last
returned sequence or null.

This is suitable for polling recent health events. It must not be used as a
lossless export/drain or billing/security accounting source. Retention gaps,
restarts and per-runtime sequences are normal to this bounded-store contract.

## Failure And Verification

Custom PlatformEventStore implementations own their own persistence/query
contract. The default HTTP endpoint simply calls the configured store.
A store that is disabled produces503 for an otherwise authorized read.

The current memory/plugin/ingest synthetic suite passed24tests/69assertions
after the retention admission correction; exact package qualification remains
pending. Test small retention, every filter, fresh runtime sequences and invalid
bounds, without reading a real event store.

- [Events](./events.md) owns runtime-local sequence/ID.
- [Endpoints](./endpoints.md) owns authenticated read and ingest.
- [Roadmap](./roadmap.md) distinguishes prospective durable viewers.
