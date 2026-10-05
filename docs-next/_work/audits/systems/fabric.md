---
id: zero.inventory.fabric
type: inventory
audience: [maintainer, agent]
owner: fabric
status: in-review
visibility: internal
system: fabric
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# ReactiveDB Fabric Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Fabric owns bounded independent physical SQLite databases, subprocess writer/read actors, immutable database realms, async capabilities, live authority fencing, hot/file placement, and tenant data-plane routing. It does not fork SQLite to provide concurrent writes inside one file.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

Fabric is ReactiveDB's multi-database execution and placement layer. A
**database reference** is an opaque logical identity, a **realm** is the
immutable schema/migration/operation contract loaded by each actor, and a
**placement** selects file or bounded hot execution. A reference or tenant ID
locates a database only after trusted authority admission; it is never authority
by itself.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Managed topology | `createApp({ databaseTopology })`; single or multiple | Always independent system/app planes; multiple adds actor-backed named/tenant files | [Draft guide](../../../backend/fabric/topology.md) |
| Opaque named/tenant identities | `createDatabaseRef`, `createNamedDatabaseRef`, `createTenantDatabaseRef` | Domain-separated correlation refs and opaque filenames; IDs not authority | [Draft guide](../../../backend/fabric/database-identities.md) |
| Immutable realm | `defineDatabaseRealm`, realm definition/types | Tables, version, ordered migrations, queries, commands, automations; checksummed fingerprint | [Draft guide](../../../backend/fabric/realms.md) |
| Composable realm contributions | `defineDatabaseRealmContribution`, `composeDatabaseRealm`, `databaseRealmContribution` | Explicit feature table/migration/handler composition; conflicts/admission validation | [Draft guide](../../../backend/fabric/realm-composition.md) |
| Subprocess launch | `runDatabaseActorIfRequested`, launch/config types; same entry or packaged actor | Bun child processes import realm locally; explicit child env allowlist | [Draft guide](../../../backend/fabric/actors.md) |
| Read/write concurrency | Read-only WAL reader actor and per-file writer FIFO | Independent file actors execute in parallel; no global SQL queue; same-file SQLite one writer | [Draft guide](../../../backend/fabric/concurrency.md) |
| Async database operations | AsyncDatabaseClient get/list/find/query/mutate/batch/command | Serializable callback-free payloads, bounded structured filters/projection/order/page | [Draft guide](../../../backend/fabric/operations.md) |
| Consistency tokens | snapshot/read-your-writes/strong; DatabaseSequenceToken | Replica snapshot or minSeq/writer visibility; independent per-database sequence | [Draft guide](../../../backend/fabric/consistency.md) |
| Idempotent writes | Mutation options/receipts and writer operation ledger | Same operation key retained receipts; outcomes/retries depend on committed/not-started/unknown | [Draft guide](../../../backend/fabric/idempotency.md) |
| Actor ownership/capacity | DatabaseCoordinator/DatabaseManager, acquire/lease/release, idle eviction | Per-file/total queues, active and file limits, permanent failure bounds | [Draft guide](../../../backend/fabric/capacity.md) |
| Replacement and shutdown | Timeout, generation/liveness, restart circuit breaker, stop/drain | Blocked generations fail closed; outcome-aware errors; parent lifecycle awaits actor disposal | [Draft guide](../../../backend/fabric/recovery.md) |
| Placement and hybrid | file/hot/selector with maxBytes, on-write or periodic durability | Placement pinned across replacement; hot snapshots bounded and watchdog supervised | [Draft guide](../../../backend/fabric/placement.md) |
| Tenant capability projection | zero.data tenant client, server-derived authority, commit fences | Tenant-database requires Guardian multi mode and live membership/profile resolution | [Tenant isolation](../../../backend/fabric/tenant-isolation.md) |
| Identity anchor provision | Framework user/membership shallow FK anchors, journal/watermark reconcile | Mirrors storage IDs only; user profile/roles/session authority stays system DB | [Draft guide](../../../backend/fabric/identity-projection.md) |
| Tenant realtime | Persistent tenant sync bindings, bounded paged snapshot/replay | Private ordered source, per-file sequence, revalidation/backpressure/readiness | [Draft guide](../../../backend/fabric/realtime.md) |
| Diagnostics/errors | DatabaseError, classifyDatabaseHttpFailure, standard observable codes | retryable + outcome + safe details; no leaking physical paths | [Draft guide](../../../backend/fabric/operations-diagnostics.md) |

## Public Surface Map

- `@zero/framework/server` exposes managed topology configuration, common
  realm/ref/placement builders and constants, actor launch helpers, app-facing
  async client types, and selected error/capacity contracts.
- `src/databases/index.ts` is the internal source barrel from which the server
  subpath selectively re-exports Fabric contracts: error and HTTP
  classification; refs/file preparation;
  manager/coordinator and authority fences; realm composition; async client and
  operations; actor launch/executor/protocol; tenant Sync; runtime; and
  observability contracts.
- The app-facing client supports get/list/find/query, mutate/batch/command,
  consistency/read options, assertions, and idempotent receipts. Realm query
  and command handlers run only inside admitted actor capabilities.
- Physical path resolution, subprocess executors, authority guards, and actor
  protocols are trusted infrastructure even where exported for composition;
  ordinary requests should use projected `zero.data` capabilities. Raw
  `zero.databases` is trusted setup/explicit unsafe infrastructure, not a normal
  multi-tenant request selector.

There is no `@zero/framework/databases` package subpath. The final guide and
examples must verify every import against the selected `@zero/framework/server`
surface rather than treating the internal barrel as independently importable.

## Configuration Inventory

`databaseTopology.mode` defaults single. Multiple requires rootDirectory, realm and actors.launch; tenantIsolation defaults shared-row, tenant-database requires multi Guardian. placement defaults file; hot shorthand on-write +64MiB; explicit hot requires maxBytes, durability, periodic cadence/watchdog when periodic. actors.env is explicit child allowlist; executor controls selected packaged actor behavior. sqlite applies actor-safe settings/ring depth.

Limits/defaults: maxDatabases16; maxDatabaseFiles10000; maxBlockedDatabases1024; maxTenantSyncDatabases `maxDatabases===1 ? 1 : maxDatabases-1`; maxTenantSyncBindingsPerDatabase64; readers true; maxQueuedPerDatabase128; maxQueuedTotal1024; queueTimeoutMs15000; operationTimeoutMs30000; idleTimeoutMs60000; sweepIntervalMs false or normalized cadence. restart is a typed bounded exponential/circuit-breaker policy. Private root cannot overlap control DB/snapshot/fence, output, or storage roots. Opaque placement selector synchronous, trusted source, never async/app HTTP policy.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

1. System Guardian state is authoritative; app runtime remains `zero.db`/`zero.sql` in setup. Scoped multi-tenant requests use async capability projected from validated current membership.
2. First actor bind establishes file identity, admits realm, runs migrations, installs declared tables/automation and FK anchors. Reader starts only on valid schema/binding.
3. Writer operations queue per file; independent databases run in separate processes. Read snapshots do not need a global writer lock. Strong/RYW requests explicitly choose consistency rather than silently assume it.
4. Identity projection validates source/target installation IDs and watermarks before readiness. Mirrors cannot authorize users or expose private Guardian profiles.
5. Durable automation source catalog uses system DB and reacquires actor source for recovery. Sync feeds per-tenant current authority and filtered data, not global shared caches.
6. Extension drains occur while services remain alive; manager closes actor leases/queues in managed shutdown. Error outcomes govern whether retry must retain same idempotency key.

## Evidence And Verification

Implementation, the internal databases barrel, and the selected server-package
re-exports were inspected. The databases directory contains 50 test files; the
Fabric Tenancy and Guardian/Fabric Proof examples exercise the topology. No
test, actor, or example was run in this pass.

- [src/frontend/server/database-topology-types.ts](../../../../src/frontend/server/database-topology-types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/database-topology-config.ts](../../../../src/frontend/server/database-topology-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-manager.ts](../../../../src/databases/database-manager.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-coordinator-config.ts](../../../../src/databases/database-coordinator-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-actor-binding.ts](../../../../src/databases/database-actor-binding.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-operation-contracts.ts](../../../../src/databases/database-operation-contracts.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-client.ts](../../../../src/databases/database-client.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-realm.ts](../../../../src/databases/database-realm.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-realm-contribution.ts](../../../../src/databases/database-realm-contribution.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-coordinator-subprocess.integration.test.ts](../../../../src/databases/database-coordinator-subprocess.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/multi-database-sync.integration.test.ts](../../../../src/frontend/server/multi-database-sync.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/databases/database-identity-projection.integration.test.ts](../../../../src/databases/database-identity-projection.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/framework/multi-database-architecture.md](../../../../docs/framework/multi-database-architecture.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Do not say multiple mode alone removes tenant columns: physical tenant-database isolation does; shared-row mode retains declared discriminators. Named databases aren't automatically tenant-authorized just because names match IDs. Child launch environment and schema/handler modules must be packaged for the real deployment. The system/app split exists even in single topology. First source pass establishes mechanisms, not crash/throughput certification.

## Known Future Plans

User plans: separate persistent logs, metrics/audit planes, branching databases and deployment/preview lifecycle tooling. Hybrid file/hot placement currently implemented; don't leave it on a future-only roadmap. Advanced same-file multiwriter SQLite fork is explicitly out of scope.

## Navigation And Cross-Link Plan

The [system entrance](../../../backend/fabric/index.md), configuration and
roadmap guides now exist. The feature matrix links each first-draft home;
source/example/artifact review remains separate.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [ ] Whole-platform reconciliation complete.
- [ ] Important examples and artifact/package support qualified.
- [x] First-draft authoritative guides exist for every inventoried group (review/qualification pending).

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
