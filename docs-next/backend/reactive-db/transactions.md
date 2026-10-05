---
id: zero.reactive-db.transactions
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: transactions
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

# Use Synchronous Atomic Transactions

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`transaction(fn)` runs one synchronous SQLite immediate transaction.
Managed row writes, sequence allocation and durable change records succeed or
roll back together. The function returns its synchronous result.

```ts
import type { ReactiveDB } from '@zero/framework/sync';

// Service fragment: db already owns the declared application table.
export function createTwoTasks(db: ReactiveDB) {
  return db.transaction(() => {
    const first = db.createStrict('tasks', { id: 'one', title: 'Review', done: 0 });
    const second = db.createStrict('tasks', { id: 'two', title: 'Publish', done: 0 });
    return [first, second];
  });
}
```

Both changes become visible to listeners only after root commit. A thrown
constraint/error rolls back both rows and their change records.

## Nested Participation And Rollback-Only

Nested transactions join the outer transaction; they are not independent
savepoints. A failed nested/managed operation marks the whole transaction
rollback-only. Catching the inner exception does not make its partial writes
committable.

The low-level [SQL TransactionManager](../persistence/transactions.md) does use
savepoints; it is a different contract and does not provide tracked change
delivery or the ReactiveDB authority/schema boundary.

Promise/thenable callbacks reject. Their rejection is consumed for safe
observation, but async continuations retain a poisoned execution context and
cannot later reopen a valid managed write. Do not perform network requests,
await AI/email or asynchronously resume a callback inside this boundary.

## Schema And Read Boundaries

Instance defineTable cannot run inside a managed transaction. Deliberate raw
DDL-only transactions are separate from tracked mutations; mixing schema
changes and tracked changes rejects even if final schema appears unchanged.
Managed schema/change-log fences protect the actual writer boundary.

Read-only snapshot callbacks cannot mutate or dispose the engine. A caught
attempt still poisons the relevant boundary. [Snapshots](./snapshots.md) owns
that API.

## After Commit

Committed change batches are delivered in order; reentrant writes queue behind
the complete batch. Then best-effort [afterCommit callbacks](./post-commit.md)
run in registration order after transaction state has reset.

Ordinary callback failure cannot undo a committed write. Internal durability
fences can report a committed-but-uncertain failure; applications must not treat
every thrown failure as proof that no write happened. Use the owning domain's
receipt/outcome contract rather than blindly retrying external effects.

## Verify

Test nested error catching, returned promises and late async continuations,
mixed DDL/write rejection, listener timing and reentrant ordering. Use synthetic
side effects and fresh stores; a transaction sample is not a production migration.

## Related Guides And Next Steps

- [Conditional writes](./conditional-writes.md) joins policy comparison to mutation.
- [Post-commit](./post-commit.md) distinguishes notifications from durable delivery.
- [Automation integration](./automation-integration.md) runs rollups while rollback is possible.
