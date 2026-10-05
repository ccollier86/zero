---
id: zero.reactive-db.overview
type: index
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: overview
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

# ReactiveDB: Tracked SQLite Data

[Backend index](../index.md) · [Documentation index](../../index.md)

ReactiveDB is Zero's synchronous SQLite data engine. Managed row writes and
their durable change records commit together; subscribers receive canonical
changes after commit. Sync adds authorized transport/state delivery; Fabric
adds isolated actors/files and async capabilities. Neither is a different
logical data engine.

This server-only layer is not a remote permission API. Ordinary app request/UI
code should use the integrated scoped services and SDK rather than create a
second raw database.

## Define And Write

- [Schema admission](./schema-admission.md): construction, one supported row key, managed DDL and foreign-key safety.
- [CRUD](./crud.md): exact-key upsert versus strict creation, merging updates and canonical results.
- [Scoped operations](./scoped-operations.md): trusted row-discriminator equality without caller-selected authority.
- [Conditional writes](./conditional-writes.md): atomic comparison against the row evaluated by policy.
- [Natural identity](./natural-identity.md): deterministic business keys and immutable identity fields.
- [Transactions](./transactions.md): synchronous atomic batches, nested participation and rollback-only failures.

## Observe And Operate

- [Post-commit callbacks](./post-commit.md): ordered best-effort synchronous notifications, not durable external delivery.
- [Snapshots](./snapshots.md): a read-only SQLite snapshot and its exact change sequence.
- [Change history](./change-history.md): durable cursors, bounded retention and explicit fresh-snapshot recovery.
- [Subscriptions](./subscriptions.md): local committed events, isolated listener copies and reentrant ordering.
- [Replica delivery](./replica-delivery.md): polling the shared durable log without skipping gaps.
- [Automation integration](./automation-integration.md): same-transaction interception versus durable effects.
- [Trusted SQL](./trusted-sql.md): raw access/introspection without pretending arbitrary writes are tracked.
- [Lifecycle](./lifecycle.md): resource ownership, disposal and safe callback diagnostics.
- [Configuration](./configuration.md): engine-specific options and delegated persistence settings.
- [Roadmap](./roadmap.md): proposed branching/SQL capabilities, distinct from current automations.

## Philosophy

The inspected design keeps the row and its event in one transaction, separates
logical identity from authorization, and rejects incomplete replay rather than
quietly advancing a cursor. Realtime is a chain of data, policy and transport
responsibilities, not a promise that raw SQL magically triggers every feature.
These are architecture observations, not performance measurements.
