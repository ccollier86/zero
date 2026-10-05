---
id: zero.sync.reconnect
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: reconnect
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reconnect, Catch-Up And Reset

[Sync index](./index.md) · [Documentation index](../../index.md)

A cursor is meaningful only with its data plane and epoch. Sync retains durable
changes and a bounded fast replay history; it does not promise infinite replay.

## Recovery Sequence

1. Reconnect and prove current authentication.
2. Present the appropriate prior stream identity/cursor.
3. Receive catch-up if the history can satisfy it.
4. Otherwise receive a fresh authoritative snapshot/reset.
5. Continue ordered live changes.

A pruned cursor, incompatible epoch or invalid history cannot be repaired by
pretending nothing changed. The client must accept a new baseline. Process epoch
and durable SQLite sequence are different concepts.

## Replica Changes

For file mode, managed polling tails tracked durable changes from other runtimes,
by default every 250ms. This is not an external message broker and cannot turn
untracked raw SQL into application change events. See
[ReactiveDB replica delivery](../reactive-db/index.md).

## Client Behavior

Low-level clients reconnect automatically unless configured otherwise. Configure
getToken/refreshAuth so recovery uses current credentials. onReconnect is a
notification, not proof that all desired application query pages were reloaded.

A failed optimistic mutation is rolled back or reconciled according to its
receipt and baseline. Exact pending mutation waits reject when their client or
authorization baseline is replaced. Retry a write only according to its operation
semantics; reconnect alone does not establish that the prior server write failed.

See [mutations](./mutations.md), [authentication](./authentication.md),
[data planes](./data-planes.md) and [lifecycle](./lifecycle.md).
