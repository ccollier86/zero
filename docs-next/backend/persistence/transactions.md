---
id: zero.persistence.transactions
type: how-to
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: transactions
maturity: supported
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Run Raw Synchronous SQL Transactions

[Persistence index](./index.md) · [Documentation index](../../index.md)

TransactionManager.runSync(callback,isolation?) owns a generic SQL
transaction/savepoint, not ReactiveDB's change/authority machinery.

Isolation accepts DEFERRED/IMMEDIATE/EXCLUSIVE; default IMMEDIATE.
Nested manager calls use SAVEPOINTs. A caught inner failure can roll back only
that savepoint while the outer caller continues. This differs deliberately from
ReactiveDB's nested rollback-only participation.

## Corrected Synchronous Boundary

The audited development implementation rejects Promise-returning callbacks at
the typed surface and rejects runtime thenables before committing. Their
synchronous writes roll back. It cannot cancel an already-started arbitrary
async continuation that directly holds a raw Database; async work is outside
this API, not a supported transaction technique.

A failed BEGIN owns no transaction: it does not roll back another caller's
boundary, and depth always retires so the next call is not falsely nested.
Callback/commit failure triggers the appropriate rollback. If rollback also
fails, AggregateError preserves both failures.

These corrections are unreleased working source, not retroactively present
in the original 2.1.1 package.

## Diagnostics And Side Effects

Exceptional rollback failure emits
PERSISTENCE_SQL_TRANSACTION_ROLLBACK_FAILED through the optional app-local
TransactionManagerOptions observability runtime, honoring emitTelemetry:false.
Its event contains no SQL, path, raw callback error or failed row contents.
Sink failure cannot replace the transaction/rollback errors.

External effects cannot be undone by SQL rollback. Perform network work outside
the transaction, then commit validated results with appropriate idempotency/
authority. Use ReactiveDB when row/change atomicity and automations matter.

## Verify

The focused synthetic regressions test thenable rollback, failed-BEGIN depth,
nested savepoint continuation, combined callback/cleanup errors and safe sink
failure. Fixtures use only fresh Bun :memory: databases.

## Related Guides And Next Steps

- [ReactiveDB transactions](../reactive-db/transactions.md) owns tracked changes.
- [SQLite service](./sqlite-service.md) injects app-local telemetry.
- [Lifecycle](./lifecycle.md) owns final close after work drains.
