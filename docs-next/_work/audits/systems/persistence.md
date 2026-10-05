---
id: zero.inventory.persistence
type: inventory
audience: [maintainer, agent]
owner: persistence
status: in-review
visibility: internal
system: persistence
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

# SQLite Persistence Foundation Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Owns Bun SQLite connection settings, prepared-statement reuse, synchronous transactions, WAL checkpoints, bounded hot snapshots, lifecycle, and supporting reusable buffers. Application and system data planes consume independent services; this foundation is not itself authentication or Fabric routing.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

Persistence supplies the SQLite storage foundation beneath ReactiveDB and
managed system/app/Fabric databases. **Hot** means an in-memory active database
with a file snapshot boundary; **file** is directly file-backed; **ephemeral**
has no recovery file. WAL improves same-database reader/writer overlap but does
not imply concurrent SQLite writers.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Storage-mode resolution | `resolveSQLiteStorageConfig`, `SQLiteStorageConfig`; hot/file/ephemeral + legacy aliases | Default mode hot; memory/:memory: aliases ephemeral; arbitrary string mode is legacy file path | [Draft guide](../../../backend/persistence/modes.md) |
| SQLite service | `createPlatformSQLiteService`, `DefaultPlatformSQLiteService`, `PlatformSQLiteService` | raw/statements/transactions/snapshot/checkpoint/buffers and diagnostics | [Draft guide](../../../backend/persistence/sqlite-service.md) |
| Connection admission | `openSQLiteDatabase` | Bun Database, mode-specific pragmas and ownership | [Draft guide](../../../backend/persistence/connections.md) |
| WAL checkpoints | `CheckpointManager`, mode/result types | File-backed WAL keeps readers alongside writer; checkpoint lifecycle, not multiwriter claim | [Draft guide](../../../backend/persistence/wal.md) |
| Hot snapshots | `SnapshotManager`, SnapshotWriteResult, hot image bounds | RAM-active database recovery image, startup source, atomic snapshot publication | [Draft guide](../../../backend/persistence/hot-snapshots.md) |
| Statement reuse | `StatementCache`, cache size config | Bounded prepared statements and disposal | [Draft guide](../../../backend/persistence/statement-cache.md) |
| Transactions | `TransactionManager` | Synchronous SQLite transactions; distinct from ReactiveDB change/authority semantics | [Draft guide](../../../backend/persistence/transactions.md) |
| Buffer pooling | `BufferPool`, BufferPoolConfig | Binary helper reuse, not retention/durable datastore | [Draft guide](../../../backend/persistence/buffer-pool.md) |
| Lifecycle and diagnostics | start/stop/close/abort/diagnostics; compatibility service getters | Close flushes mode boundary, abort startup without snapshot publishing | [Draft guide](../../../backend/persistence/lifecycle.md) |

## Public Surface Map

- `@zero/framework/persistence` exports `resolveSQLiteStorageConfig`, all
  storage config/resolved/diagnostic types, `openSQLiteDatabase`, and
  `createPlatformSQLiteService`/`DefaultPlatformSQLiteService`.
- It also exports `CheckpointManager`, `SnapshotManager` and snapshot timeout
  policy constants/helpers, `StatementCache`, `TransactionManager`, and
  `BufferPool` with their option/result types.
- Platform SQLite service get/require/set/clear functions are compatibility
  runtime globals. Managed `createApp` composition owns app-local services and
  should not depend on one ambient current instance.
- Raw Bun SQLite connections and service handles are trusted server primitives;
  they do not apply Guardian, Resource, ReactiveDB, or Fabric authority.

## Configuration Inventory

| Option | Type / observed default |
| --- | --- |
| `mode` | hot/file/ephemeral; omission hot; legacy memory/:memory: ephemeral |
| `path` | file/source path; default `./data/app.db` |
| `snapshotPath` | hot only; explicit, or path; default app path gets `./data/app.snapshot.db` |
| `snapshotEnabled`, `snapshotIntervalMs` | hot true, 30000ms; false outside hot |
| `hotMaxBytes` | Optional positive serialized-image byte bound; no generic standalone bound when omitted |
| `emitTelemetry` | true; internal actors disable emitted persistence telemetry |
| `cacheSize`, `mmapSize` | -262144, 1073741824 |
| `walAutocheckpoint`, `pageSize` | 1000, 4096 |
| `synchronous`, `tempStore` | NORMAL, MEMORY |
| `busyTimeout`, `statementCacheSize` | 5000ms, 1000 |
| `bufferPool` | false or object; maxPoolSize 100, preallocate true |

Config resolves at construction; no per-request environment binding in this resolver. Injected services/raw handles have explicit ownership. File settings do not imply snapshots; RAM hot snapshots are not file-mode WAL. Snapshot failure/timeout health belongs durable lifecycle evidence, not automatic retry guarantees.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

ReactiveDB adopts a service rather than opening a second handle. Managed runtime creates system/app services separately. Fabric subprocesses import a fixed realm and open own writer/reader services; hot placement adds explicit bounds/durability stricter than standalone hot default. SQL helpers and built-in services use the shared foundation for their own data plane. Service disposal must precede handle reuse and not publish failed-start state.

## Evidence And Verification

Implementation and the persistence subpath barrel were inspected. One direct
persistence test file is present; wider behavior is exercised through
ReactiveDB/Fabric integration tests, but none was run in this pass.

- [src/persistence/index.ts](../../../../src/persistence/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/storage-types.ts](../../../../src/persistence/storage-types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/storage-config.ts](../../../../src/persistence/storage-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/sqlite-connection.ts](../../../../src/persistence/sqlite-connection.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/platform-sqlite.ts](../../../../src/persistence/platform-sqlite.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/platform-sqlite-runtime.ts](../../../../src/persistence/platform-sqlite-runtime.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/platform-sqlite.test.ts](../../../../src/persistence/platform-sqlite.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/snapshot-manager.ts](../../../../src/persistence/snapshot-manager.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/persistence/checkpoint-manager.ts](../../../../src/persistence/checkpoint-manager.ts): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Standalone hot snapshot cadence and Fabric on-write/periodic durability are different contracts. Do not promise on-write durability merely from `db.mode: 'hot'`. Local disk backups, filesystem guarantees, and injected handles are explicit operational responsibilities; exact tests/package qualification remain pending. The clean baseline's `src/persistence/index.ts` comment incorrectly deferred app-factory/ReactiveDB integration to “later slices”; the current documentation branch corrects that comment to match existing composition. This was source-comment drift, not a runtime defect.

## Known Future Plans

User plans: independent logging/metrics/audit Fabric planes; hybrid placement is already present in Fabric and is not future-only. Additional storage engines are ideas, not this service API.

## Navigation And Cross-Link Plan

The [system entrance](../../../backend/persistence/index.md), configuration and
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
