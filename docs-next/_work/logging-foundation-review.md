---
id: zero.logging-foundation-review
type: operations
audience: [developer, agent, maintainer, operator]
owner: observability
status: in-review
visibility: internal
---

# Logging Foundation Branch Review

[Working index](./index.md) · [Complete subsystem plan](./logging-system-plan.md)

The first implementation milestone on `feature/core-logging` is the private
storage and evidence foundation. It is based on main
`e3809f4a94fc53b0168246128c844806a6757513`. It does not enable logging in managed
apps, change Guardian audit, publish SDK names or modify saved releases.

## Implemented Foundation

| Responsibility | Source and behavior |
| --- | --- |
| Data contract | `src/logging/logging-contracts.ts`: browser-safe envelopes, scope, actor/service provenance, outcomes, event receipt and bounded query/page shapes. |
| Configuration | `logging-config.ts`: basic/activity/detailed/compliance capture presets, granular families, independent diagnostic severity and bounded writer limits. Compliance starts with activity coverage; view/copy/print observations require explicit policy selection. A compliance request is not a readiness assertion. |
| Admission | `logging-validation.ts`: descriptor-safe snapshots, no getter/proxy evaluation, strict envelope identities/types, explicit metadata allowlists and secret/content-key rejection. Browser observations cannot claim server/provider confirmation. |
| Storage | `logging-schema.ts`, `logging-realm.ts`: separate file bindings for audit/operational streams; registered synchronous Fabric commands/queries over tracked ReactiveDB. Indexes support scoped, actor, target and time investigations. |
| Replay | Stable source/event identity and content fingerprint prevent duplicate rows after regrouping/restart. A changed body under the same event identity rejects the complete batch. Fabric command receipts are an additional, not sole, deduplication mechanism. |
| Queries | `logging-query.ts`, `logging-results.ts`: mandatory scope predicates, static column vocabulary, bound values, source-local high-water/keyset pagination, revalidated envelopes, scope and cursor state. |
| Delivery | `logging-fabric-store.ts`, `logging-writer.ts`: acknowledgments only after actor commit, outstanding record/byte capacity accounting, batching within Fabric payload limits, unknown-outcome preservation and joined flush/shutdown drain even when an earlier batch fails. |

The storage port accepts an already-bound private Fabric client. Integration
tests launch actual subprocess actors with FULL file durability and separate
audit/operational files. There is no in-memory storage substitute in those tests.
The batching owner is asynchronous; Fabric's existing subprocesses own SQLite
execution and their bounded operation deadlines.

## Verification

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/logging src/databases/database-coordinator-subprocess.integration.test.ts
bun --no-env-file x tsc --noEmit
bun --no-env-file docs-next/_work/checks/check.ts
```

The focused run passes 31 logging tests and 4 existing Fabric subprocess
regressions. It checks real restart/isolation, conflicting-batch atomicity,
deduplication after acknowledgment loss, large-event batching/page limits,
scope/cursor corruption, browser contract bundling, policy validation and worker
admission/drain outcomes. Diagnostics use the external project's
`diagnostics/logging-*` artifacts, synthetic inputs and disposable databases.
The root TypeScript check passes; the documentation check finds 816 reachable,
uniquely identified pages and no problems.

Initial construction exposed two integration mistakes that are corrected:
realm migrations execute before table registration, so the logging migration
establishes the same fixed tables before creating indexes; Fabric named command
responses wrap their domain output, so the adapter validates and unwraps that
envelope before acknowledging events. These are branch-local implementation
corrections, not changes to Fabric or consuming apps.

## Remaining Integration Gates

1. Managed dedicated-plane/actor startup, lifecycle registration, service facade
   and explicit app configuration. The current resolver is internal groundwork,
   not a working `createApp.logging` option.
2. Atomic originating-transaction capture/outbox delivery, Guardian audit
   compatibility/bridge and service-by-service instrumentation. The batching
   queue is not a durable origin outbox and does not guarantee that an application
   mutation is automatically audited.
3. Live scoped server APIs, SDK, query subscriptions and browser activity collector.
   A store's trusted `platform` query scope is not an authorization decision.
4. Reusable hooks/workspace and the separately planned advanced Filters family.
   No logging UI or observed viewing/copy/printing collector is implemented yet.
5. Retention/holds, independent integrity/custody, exports and review evidence,
   configured health/failure policies, full load/crash/security/browser and
   installed-package qualification before exposing compliance readiness.

Application interfaces must not import these private modules as a substitute
for the missing managed integration. Existing main and saved update packages
remain unchanged; this milestone is not an upgrade-ready logging release.
