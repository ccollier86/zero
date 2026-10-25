---
id: zero.audit.application-data-facade
type: operations
audience: [agent, maintainer]
owner: fabric
status: in-review
visibility: internal
---

# Application Data Facade and PracticeIQ Preparation

[Audit index](./index.md) · [Documentation index](../../index.md)

Implementation baseline: framework 2.6.0, commit
`73022b37deacfdd33cbefb24f329d2656eaf4b76`, October 25, 2026. Work began on
`feature/unified-data-facade` from the separately retained PracticeIQ handoff.
No PracticeIQ source, clinical database, environment, provider or deployment
was modified or opened by this work.

## Corrections

- Added a managed primary app adapter for request `zero.data`, reusing the
  existing Fabric client, operation validation, read/command execution, FIFO
  and durable receipt implementation. Tracked mutations keep the same reactive
  sequence/change stream. No separate ORM, raw request SQL or cross-file queue.
- Added optional `dataRealm` admission for schema-identical app queries and
  commands. Tenant-file declarations must match their actor realm; unrelated
  named realms remain independent. Shared-row tenant requests still receive no
  unrestricted primary client. System and logging ownership stays separate.
- Preserved synchronous live-authority checks at admission, queued execution,
  primary commit and result delivery. No auth lease is held across an awaited
  callback. Registered primary reads reuse the query-only pinned handle rather
  than copying the entire hot database. Reading alone creates no receipt schema.
- Added a private full-inventory table-map guard to the migration-preparation
  toolkit. It rejects partial inventories, omitted/duplicate/unmapped tables and
  stale schema/value fingerprints. It performs no migration or target validation.
- Updated the framework and PracticeIQ guides, preserving single tenancy,
  custom public styling, consistent backup/restore and explicit cutover gates.

## Checks Run

- Focused source run: **115 passed, 0 failed, 897 assertions across 11 files**.
  Includes populated primary memory/file/hot, real tenant actors, exact-total
  pagination, tracked delivery, canonical replay after restart, atomic rollback,
  validator metadata, cancellation/backpressure, authority and compatibility.
- Populated hot/outbox/login/refresh/logging regression: **1 passed, 0 failed,
  176 assertions** in the isolated rerun, approximately 59 seconds. The earlier
  concurrent run exceeded its 90-second overall deadline during this broader
  workload; it is not recorded as a pass. Individual auth latency assertions
  and final source/logging settlement passed in the isolated run.
- Fresh installed source-package consumer: **1 passed**, exercising all four
  managed HTTP modes through public package imports and real Guardian/actors.
- Actual Markdown examples and original preparation guards: **9 passed**;
  standalone preparation tools typecheck and root typecheck exited successfully.
- Expanded preparation/core/registry run: **26 passed, 0 failed, 160 assertions**,
  including the new complete table-map guard. Documentation structure at the
  earlier checkpoint: 835 pages, unique/reachable IDs, no problems.

Exact committed-archive qualification and saved-release identity are release
gates, separate from these source results. Diagnostic output and generated
packages remain in designated external artifacts/scratch, not this tree.

## Remaining Boundaries

The PracticeIQ app agent must implement and test its actual legacy conversion;
the preparation tools are not that converter or permission to deploy. Strict
logging compliance remains gated. Native actor-backed system/Guardian execution
and wider cross-mode performance benchmarks are explicitly deferred. The SEO
metadata gap is recorded in the router roadmap, not implemented incidentally.
