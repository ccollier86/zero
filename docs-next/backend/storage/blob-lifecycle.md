---
id: zero.storage.blobs
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: blobs
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Content-Addressed Publication And Cleanup

[Storage index](./index.md) · [Documentation index](../../index.md)

Byte publication and SQLite metadata commit are different operations.
Storage coordinates them with publication receipts, reference counts,
leases and bounded reconciliation rather than assuming a successful stream
automatically means an object record committed.

## Upload

The adapter validates streams/size and publishes bytes under their checksum.
The engine admits current quota/authority/lifecycle, commits logical metadata
and references, then settles the publication receipt.
A failure before metadata acceptance must not orphan an invisible successful
object or prematurely claim its upload succeeded.

Pending durable publications survive the supported local restart boundary and
are reconciled against actual references. Do not delete an existing shared blob
merely because a later upload of the same bytes failed.

## References And Deletion

Object copy/overwrite/delete adjusts references in the metadata transaction.
Zero-reference physical cleanup validates durable leases and current state under
SQLite's writer lock, invoking removeBlobSync without yielding between the
fence and deletion.

Asynchronous external deletion alone cannot provide that shared-CAS fence.
Use the [required adapter contract](./adapters.md), not an unsafe cleanup callback.

## Bounded Work

Cleanup/reconciliation uses bounded batches, cursors, retryable jobs and
maintenance wakeups. Operational success means actual metadata/publication
outcomes, not a fire-and-forget Promise.

Equal bytes can remain because another logical object still references them.
Deletion of one drive is not permission to wipe the whole storage root.
Publication journals/refcounts are internal system state; clients do not edit
them directly.

See [objects](./objects.md), [Studio lifecycle](./studio-lifecycle.md),
[errors](./errors.md) and [composition](./composition.md).
