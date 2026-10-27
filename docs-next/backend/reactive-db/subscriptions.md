---
id: zero.reactive-db.subscriptions
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: subscriptions
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

# Observe Committed Changes On The Server

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`onChange(listener)` works on a live server instance independently
of any browser socket. It returns an unsubscribe function.

```ts
import type { ReactiveDB } from '@zero/framework/sync';

export function observeTaskIds(db: ReactiveDB, changed: (id: string) => void) {
  return db.onChange((change) => {
    if (change.table === 'tasks') changed(change.rowId);
  });
}
```

This fragment intentionally emits only an ID through a trusted synchronous
callback; it does not publish rows to arbitrary users.

## Delivery Contract

Local commits notify synchronously after commit. With external polling active,
the durable dispatcher is the single ordered path for local and external
commits; external changes arrive when it drains.

Each callback receives its own canonical Change and delivery metadata copy.
Subscription changes during a callback do not skip another listener already in
that event's snapshot. Reentrant writes queue after the complete committed
batch instead of interleaving earlier/later sequences.

Listeners must be synchronous. Returned promises/thenables are consumed and
reported, not awaited. A listener error does not roll back the committed row or
prevent remaining listeners. Disposal during delivery is rejected.

## Not A Durable Trigger Or Public Subscription

### Private/raw transaction wake hints (feature-branch addition)

`onCommit(listener)` observes settled local root transactions, including private
prepared SQL which intentionally produces no ordinary row-change records. It is
payload-free, synchronous, best-effort, and returns an idempotent unsubscribe.
Nested transactions emit only their root's hint; rollback emits none. Actual
commit-authority leases have been released before callbacks run. Observer failure
does not change the committed outcome and uses existing post-commit diagnostics.
Commit-observer failures emit only the stable failure code, not callback exception
messages, row data or identifiers.

The signal also covers an explicitly committed read-only transaction; it is not
proof a particular table or value changed. Re-read the service's authoritative
revision/state, coalesce work, and never manufacture INSERT/UPDATE events from
it. This is a local wake mechanism, not a durable or ordered cross-process feed.
External writers still need the service's supported revision/reconciliation path.
The messaging correction uses it with Guardian's existing authority clock for
configured group maintenance. Stable archives without this addition do not
gain the method merely from this draft manual.

A process-local listener is useful for small synchronous coordination. It
cannot guarantee an external effect survives a crash. Use same-transaction
automation for a rollup/invariant and durable automation/Torrent for external work.

Sync/Resources still enforce what users may see. Do not broadcast the listener's
full row before checking current authority/tenant/field policy. The engine's
local subscription is not itself a WebSocket access policy.

## Verify And Clean Up

Retain the remover and call it when the owning service stops. Test listener
throw/thenable behavior, alias isolation, unsubscribe during dispatch and
reentrant transaction batches. For another file connection also exercise
[replica polling](./replica-delivery.md).

## Related Guides And Next Steps

- [Reactivity](../../concepts/reactivity.md) explains policy-filtered browser fanout.
- [Automation integration](./automation-integration.md) chooses transactional/durable actions.
- [Lifecycle](./lifecycle.md) owns cleanup and safe listener failure reporting.
