---
id: zero.reactive-db.snapshots
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: snapshots
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

# Read Rows And Their Cursor From One Snapshot

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`readAtCurrentSequence(reader)` returns `{value,seq}` from one
SQLite read snapshot. Reading the sequence first establishes the snapshot used
by later queries in the synchronous reader.

```ts
import type { ReactiveDB } from '@zero/framework/sync';

export function readTasks(db: ReactiveDB) {
  return db.readAtCurrentSequence(() => db.list('tasks'));
}
```

This fragment assumes trusted server access to a defined table. It reads all
rows; use the bounded async data/query surface for large user-facing pages.

## Read-Only And Synchronous

The reader must be synchronous and read-only through managed APIs. A managed
write, schema change or disposal attempt poisons the snapshot, even if its
exception is caught. An async/thenable result rejects; its later execution
context remains poisoned against managed access.

Raw SQL handles remain deliberately trusted escape hatches. They are not a
supported way to weaken the reader's contract or manufacture a matching cursor.

Inside a compatible existing transaction/read snapshot, the read participates
in that context. It does not introduce an independent network/database snapshot
across multiple Fabric files.

## Cursor Meaning

The returned seq represents the read snapshot, not the current head at some
later time. Pair it with the correct database/data-plane identity and Sync
epoch when applicable. Do not reuse one file's cursor for another file.

A replay gap requires an authoritative fresh snapshot rather than guessing
which cached rows should be retained.

## Verify

Force another writer between stages using disposable connections and verify
that rows and seq describe one snapshot. Test rejected async readers, caught
write attempts and late continuations. Typechecking a callback does not prove
it remained read-only at runtime.

## Related Guides And Next Steps

- [Change history](./change-history.md) explains retention/gap recovery.
- [Transactions](./transactions.md) distinguishes a write boundary.
- [Reactivity](../../concepts/reactivity.md) connects snapshot/catch-up to frontend state.
