---
id: zero.fabric.concurrency
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: concurrency
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

# Concurrency Across And Within Databases

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Different Files

Active logical databases have independent subprocess actors and per-database
queues. A long writer command in database A does not route database B's writes
through A's SQL queue. Bun actors permit actual execution overlap across files;
the coordinator still enforces app-wide admission and capacity bounds.

This is concurrency within one managed application runtime, not distributed
ownership across independently launched servers pointing at the same root.
Do not interpret private file locks as a replicated consensus service.

## One File

SQLite remains single-writer per file. Fabric serializes tracked writes in the
writer lane, preserving mutation, change-log and receipt ordering. A separate
read-only WAL reader actor is enabled by default for file placement; snapshot
reads can overlap writes according to SQLite snapshot visibility.

An already-open read snapshot need not see a just-committed writer result.
Choose [read-your-writes or strong consistency](./consistency.md) when needed.
`readers: false` removes the separate reader actor rather than introducing
concurrent writes inside the file.

Hot placement owns a RAM-active image and durability policy. Do not treat a
file WAL reader as a second connection to another process's private RAM image;
placement-specific routing remains managed by Fabric.

## Bounded Work

Queued work is bounded per database and across the app. Queue timeouts describe
pre-dispatch waiting; execution timeouts describe a dispatched actor operation.
Cancellation is honored before dispatch, not an interruption of arbitrary
synchronous SQL or handler code already executing.

Keep commands small and synchronous. Network requests, human input waits and
long AI work belong outside the SQLite command transaction, commonly in
workflow engine or a
durable automation integration. Persist the necessary correlation record and
perform a short tracked update when external work completes.

See [capacity](./capacity.md), [operations](./operations.md) and
[recovery](./recovery.md) for admission, outcomes and replacement.
