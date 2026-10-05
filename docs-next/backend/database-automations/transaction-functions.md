---
id: zero.database-automations.transaction-functions
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: transaction-functions
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Atomic Transaction Functions

[Database automations](./index.md) · [Functions](./functions.md) · [Documentation index](../../index.md)

Use transaction functions for rollups, related rows and invariants that must
commit with the source mutation in the same physical database. Do not await
network/AI/email work or start fire-and-forget effects; use a
[durable function](./durable-functions.md).

## Rollups And Capability

The [configuration example](./configuration.md#pinned-database) commits its
origin insertion and counter update atomically. An exception rolls both back,
including their change records; rejected changes do not reach observers.
For an update delta use previousRow and row from the immutable snapshot.

DatabaseTransactionFunctionCapability provides tracked create/insert,
strict/scoped create, update/delete variants, identity CRUD, query/list,
get/queryOne/scoped reads, identity helpers and nested transaction(callback).
It excludes afterCommit, raw SQL/SQLite, schema methods, listeners, internal
change APIs, disposal and other Zero services.

The frozen null-prototype facade closes after each handler. Retaining it for a
later promise/timer fails with DATABASE_CLOSED. Nested callbacks receive the
same narrow capability and cannot independently commit past root rollback.

## Guardian Anchors

Canonical Guardian identities live in system.db. ID-only app anchors support
foreign keys, never login or live authority. Protection differs by mode:

- Pinned projection installs anchor SQL tables but does not register them as
  app ReactiveDB CRUD tables; the narrow capability cannot query/mutate them.
- Fabric registers only required anchor schemas and explicitly marks them
  read-only across ordinary, nested and identity-based mutation methods.

An automation may write app rows with valid field.guardianUser() or
guardianMembership() foreign keys. It cannot fabricate canonical identities
through its supplied capability.

Trusted raw handles remain privileged by design. This is not a guarantee that
arbitrary raw SQL or an explicitly reconfigured trusted registry is read-only.
Use [runtime services](../runtime/server-services.md), not raw handles exposed
to an untrusted caller.

## Cascades And Budgets

Tracked handler writes may trigger further matching changes. Queue drainage is
breadth-first: current-match targets run in declared order before newly
generated changes drain. Managed trigger order is canonical identity order.
There is no async parallel execution inside one transaction.

Managed per-root defaults are depth 16, tracked changes 256, function executions
256 and captured durable effects 256. These internal limits are not public
AppConfig knobs. Exceeding a budget raises DATABASE_PAYLOAD_LIMIT and aborts the
root commit. Avoid self-triggering changes; only write when a new state differs.

## Failure And Verification

Non-DatabaseError handler exceptions become safe DATABASE_EXECUTOR_FAILED,
outcome not-committed; their private cause is not a public message. Promise-like
returns fail synchrony admission. Catching a write error cannot repair a
rollback-only root transaction.

Test a synthetic origin plus a failing later target and verify rows, rollups,
outbox and sequence remain unchanged. The repository transaction-runtime tests
exercise this. The pinned identity-boundary test additionally proves projection
ownership without registering invented app anchor tables.

Related: [inputs](./inputs.md), [triggers](./triggers.md),
[ReactiveDB](../reactive-db/index.md), [testing](./testing.md).
