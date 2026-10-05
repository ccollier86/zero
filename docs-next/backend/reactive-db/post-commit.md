---
id: zero.reactive-db.post-commit
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: post-commit
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

# Notify After Commit Without Confusing Durability

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`afterCommit(callback)` registers synchronous best-effort work for
the current managed transaction. It requires an active transaction; nested
registrations join the outer queue.

After successful root commit, callbacks run once in registration order after
committed change delivery and transaction-state reset. Rollback discards them.
Failure does not undo the commit or skip later callbacks.

```ts
import type { ReactiveDB } from '@zero/framework/sync';

export function updateThenNotify(db: ReactiveDB, notifyCommitted: () => void) {
  return db.transaction(() => {
    const change = db.update('tasks', 'synthetic-task', { title: 'Reviewed' });
    if (change) db.afterCommit(notifyCommitted);
    return change;
  });
}
```

This service fragment assumes the table/current authority and a synchronous
local callback. The callback is not an async email or durable webhook operation.

## Appropriate Use

Use it for a small synchronous local notification/invalidation that does not
need durable retry. The callback may enqueue an app-owned operation, but that
queue's reliability belongs to its owner.

Do not use an async callback as a transactional email/webhook delivery guarantee.
Returned thenables are consumed, not awaited, and reported as a synchronous
callback contract violation. A process crash after commit can lose the callback.

Durable effects need the database-automation outbox/dispatcher or a registered
Torrent activity with its idempotency/recovery rules. An ordinary listener or
afterCommit callback is not a durable message bus.

## Internal Fences

The instance also has internal mandatory post-commit/commit coordination seams
for platform durability/authority. They are not an application notification API
or permission to write arbitrary internal change records. Public feature
examples should use afterCommit or the admitted automation service.

## Verify

Test active-boundary admission, rollback discard, nested registration order,
callback exception isolation and returned thenables. Observe that the row is
already committed when a notification fails; retries must not duplicate the
original operation merely because a notification failed.

## Related Guides And Next Steps

- [Transactions](./transactions.md) defines the commit boundary.
- [Subscriptions](./subscriptions.md) delivers row-level committed changes.
- [Automation integration](./automation-integration.md) chooses durable effect delivery.
- [Lifecycle](./lifecycle.md) owns safe callback failure codes.
