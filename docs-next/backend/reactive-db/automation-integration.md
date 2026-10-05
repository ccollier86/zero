---
id: zero.reactive-db.automation-integration
type: architecture
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: automation-integration
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

# Choose Transactional Logic Or Durable Effects

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

ReactiveDB supplies a same-transaction interception seam after a
canonical managed change is recorded, while the root transaction can still
roll back. The higher-level database-automations registry owns named functions,
AFTER matching, bounded cascades, realm admission and durable delivery.

These logical AFTER triggers are not a promise of arbitrary SQLite
CREATE TRIGGER support.

## Public Low-Level Seam

`registerReactiveDBMutationInterceptor(db,interceptor)` is public from
`@zero/framework/sync`. A live instance admits one interceptor; a second
registration rejects. The returned remover is idempotent and identity-safe.

The callback receives a deeply immutable canonical change and opaque
transactionToken. It is synchronous: throwing or returning a thenable rejects
the complete root transaction. Retaining the token after the callback grants
no continued transaction authority.

Managed automations already use this seam. Do not install a competing interceptor
or a second adhoc trigger registry under the same app.

## Three Different Boundaries

| Need | Correct boundary |
| --- | --- |
| same-database rollup/invariant | admitted synchronous transaction function/AFTER automation |
| lightweight process-local invalidation | committed listener or best-effort afterCommit |
| email/webhook/workflow resume that must recover | admitted durable automation/outbox or Torrent activity |

External calls must not hold the SQLite writer transaction open. A listener that
starts an async fetch is not a crash-durable substitute for an outbox.

For workflow resumption, correlate to one invocation/event and use its durable
idempotency rules; a generic “some row changed” broadcast must not resume every
waiting run.

## Authority And Raw Writes

Automation executes only on the admitted tracked mutation path. Raw SQL writes
do not automatically invoke it or create canonical change records.
Actor realms install their registry on each target; pinned app automations are
configured separately.

A function's ability to update another table still needs its declared
capability/authority boundary. Do not treat a change payload or local user
anchor as an actor permission.

## Verify

Test root rollback after interceptor failure, immutable snapshots/token lifetime,
bounded nested updates and no external effect before commit. Durable behavior
also needs crash/retry/idempotency and exact invocation-correlation checks.

## Related Guides And Next Steps

- [Transactions](./transactions.md) owns rollback participation.
- [Post-commit](./post-commit.md) is explicitly best effort.
- [Service boundaries](../../concepts/service-boundaries.md) owns actor authority.
- [Trusted SQL](./trusted-sql.md) explains untracked escape hatches.
