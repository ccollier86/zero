---
id: zero.database-automations.delivery
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: delivery
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

# Durable Outbox Delivery And Recovery

[Database automations](./index.md) · [Durable functions](./durable-functions.md) · [Documentation index](../../index.md)

Each durable source owns a private SQL outbox committed atomically with origin
data. system.db catalogs physical sources for discovery/restart. A host worker
claims a delivery after the writer lane is released; no external handler holds
that lane while waiting on network work.

## Delivery Semantics

A command progresses pending → processing → completed or pending retry.
Exhausted/unavailable work becomes dead. Claims carry owner/token/expiry fences;
renewal, completion, retry and dead-letter transitions must match the live
attempt. Late completions cannot reclaim a lost lease.

At-least-once applies to the external handler. External success followed by
process failure before recording completion may repeat that effect.
Idempotency belongs to the downstream action or business uniqueness as well as
the local command ID. Completed/terminal metadata retention is bounded, not a
permanent global deduplication guarantee.

The worker recovers expired processing leases before draining. It resolves the
stored exact durable function version. A missing/wrong-mode version becomes
AUTOMATION_FUNCTION_UNAVAILABLE; manifest drift is observed, not a silent
replacement by latest code.

## Managed Defaults

These are inspected implementation defaults, not public AppConfig knobs:

| Policy | Default |
| --- | --- |
| Host source scan interval | 1 second |
| Concurrent physical sources | 8 |
| Worker processing lease | 30 seconds |
| Lease renewal interval | 10 seconds |
| Handler execution timeout | 5 minutes |
| Maximum persisted attempts per command | 20 |
| Retry delay | Exponential from 1 second, capped at 5 minutes |
| Payload bytes per command | 1 MiB |
| Active commands per source | 10,000 |
| Active payload bytes per source | 64 MiB |
| All stored command records per source | 20,000 |
| Retained terminal metadata records | 10,000 |

The managed dispatcher gives each catalogued source one delivery turn per pass,
then immediately rescans while backlog exists. This preserves source fairness
instead of letting the first occupied slots monopolize admission. One source
worker is sequential; different physical sources can execute concurrently.

The lower-only internal store limits also have hard bounds: 1 MiB payload,
100,000 active records, 256 MiB active bytes, 1,000,000 stored records,
900,000 terminal records and 100 attempts. These are not memory/process-total
quotas, or public deployment setters to copy into an app config.

## Capacity And Retention

Enqueue capacity checks occur inside the source transaction. Oversized input,
active backlog pressure or total stored capacity rejects the originating
mutation instead of committing an effect that cannot be represented durably.

Completion/dead-lettering scrub retained payloads and compact oldest excess
terminal metadata while preserving active records/accounting. Terminal delivery
IDs can eventually leave retention; do not treat this table as an eternal
business uniqueness ledger.

The outbox is private, not a browser-readable Sync queue or supported public
redrive API. Do not delete private rows manually to hide a failed business
action. Reconcile the business action through authorized application code.

## Shutdown, Timeout And Authority

Managed cleanup closes intake, aborts worker lifetime and awaits controlled
release before database/service disposal. Timeout/shutdown revokes scope-bound
services and prevents stale terminal completion. External verification/calls
can settle but cannot reactivate a closed execution. Cooperating external
adapters should observe context.signal.

Cancellation cannot undo a request a provider already accepted. Keep external
idempotency regardless of the local lease and distinguish ambiguous outcomes
from guaranteed not-started work.

## Verification And Related Guides

Test source rollback/outbox atomicity, restart discovery, expiry/reclaim,
manifest drift, unavailable versions, bounded retry and late completion.
Use [testing](./testing.md) and [operations](./operations.md), then qualify the
actual deployment artifact and actor launch—not just unit tests.

[Versioning](./versioning.md) explains retaining exact handlers;
[services](./services-and-authority.md) explains live scope fences;
[runtime shutdown](../runtime/shutdown.md) explains managed dependency ordering.
