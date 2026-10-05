---
id: zero.inventory.migrations
type: inventory
audience: [maintainer, agent]
owner: migrations
status: in-review
visibility: internal
system: migrations
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

# Migrations And Schema History Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Owns ordered immutable migration registries, per-migration atomic application and rollback, checksummed append-only ledger, installed schema snapshots/diffs, backup artifacts/safety policy, and CLI plan/doctor/status tooling. Data-plane targeting must be explicit.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A **migration registry** is an ordered immutable list of versioned synchronous
SQLite changes. The **ledger** records applied versions/checksums; **schema
history** records inspected snapshots; a **plan** is generated guidance rather
than automatic permission for destructive DDL. System migrations and Fabric
realm migrations share concepts but install into different data planes.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Migration declarations | Migration version/description/up/down/safety/downSafety/backupRequired | Synchronous Bun Database functions; ordered immutable registry | [Draft guide](../../../backend/migrations/declarations.md) |
| Apply and recovery ledger | Migrator.run(toVersion?), status/list; MigrationLedger | BEGIN IMMEDIATE per migration; prior successful steps remain committed on later failure | [Draft guide](../../../backend/migrations/apply.md) |
| Registry admission/checksums | createMigrationRegistry, hashMigration | Duplicate/version/dependency/retained checksum consistency, no editing applied content | [Draft guide](../../../backend/migrations/registries.md) |
| Rollback | Migrator.rollback(toVersion?) | Down required; reverse applied order and independent destructive safety permission | [Draft guide](../../../backend/migrations/rollback.md) |
| Schema snapshots/history | SchemaHistory, inspectDatabaseSchema, snapshotDeclaredTables, hashes | Installed SQL metadata/indices/identity and append-only history | [Draft guide](../../../backend/migrations/schema-history.md) |
| Drift diff and Doctor | diffSchemaSnapshots, runMigrationDoctor | Declared vs installed schema and diagnostic severity | [Draft guide](../../../backend/migrations/doctor.md) |
| Migration planning | createMigrationPlan, renderMigrationPlan | Draft DDL/operations safety, not blind automatic destructive apply | [Draft guide](../../../backend/migrations/planning.md) |
| Backups/artifacts | Public `MigrationSafety` and backup policy; internal `MigrationArtifacts` implementation | Destructive gates and backup records, no rollback guarantee without actual down/backup | [Draft guide](../../../backend/migrations/backups.md) |
| Managed data-plane installation | System built-in registry, realm migrations for isolated files | AppDatabaseBootstrap/DatabaseRuntime before schema/service readiness | [Draft guide](../../../backend/migrations/data-planes.md) |
| CLI commands | zero migrate and package scripts status/doctor/plan | Explicit DB/schema/registry target; app config/source imports trusted execution | [Draft guide](../../../backend/migrations/cli.md) |

## Public Surface Map

- `@zero/framework/migrations` exports the built-in ordered `migrations`
  registry, `Migrator`, `createMigrationRegistry`, registry/config/status types,
  migration/ledger/plan/safety/schema types, and `MigrationLedger`.
- It also exports `SchemaHistory`, schema inspection/snapshot/hash/diff helpers,
  `createMigrationPlan`/`renderMigrationPlan`, and `runMigrationDoctor`.
  `MigrationArtifacts` is internal and is not a named package export.
- `zero migrate` is the CLI entry point for apply plus status/checkpoint/doctor/
  plan/down and target controls. Schema/config/registry module selection imports
  trusted code; it is not static inspection.
- Managed startup applies built-in system migrations and app schema readiness;
  Fabric realms own separate ordered migrations and an immutable fingerprint.

## Configuration Inventory

`MigratorConfig`: dbPath or injected database; ownsDatabase false for injection; ordered migrations required; applyPragmas defaults true for owned DB, false for injected; busyTimeoutMs30000; allowDestructive false; allowDestructiveDown false; backupDir derived from target parent/backups; createBackups true unless path handling excludes ephemeral; log default standardized observability sink. Startup `migrate` defaulttrue at app resolver; realm carries its own immutable registry. CLI flags are cataloged by cli-tooling; no shared app/system file inferred from a command lacking target.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

System migrations install Guardian/platform service state independently from application's user schemas. Realm migration checksum participates in actor handshake; first bind must finish migrations before reads. Foreign-key anchors need dependency order; arbitrary DDL is not a tracked user write. Migration log defaults to OBS_CODES.MIGRATOR_LOG; explicit log injection is app-owned. Backup artifacts stay with operational storage rather than new docs.

## Evidence And Verification

Implementation, the migrations package barrel, built-in 37-entry registry, and
CLI dispatch were inspected. The migrations directory contains 39 test files;
none was run and no database or migration module was opened in this pass.

- [src/migrations/index.ts](../../../../src/migrations/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/migrator.ts](../../../../src/migrations/migrator.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/types.ts](../../../../src/migrations/types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/migration-ledger.ts](../../../../src/migrations/migration-ledger.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/schema-history.ts](../../../../src/migrations/schema-history.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/schema-inspector.ts](../../../../src/migrations/schema-inspector.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/migration-planner.ts](../../../../src/migrations/migration-planner.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/migration-doctor.ts](../../../../src/migrations/migration-doctor.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/run.ts](../../../../src/migrations/run.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/migrations/migrator.test.ts](../../../../src/migrations/migrator.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/system-database-layout.ts](../../../../src/frontend/server/system-database-layout.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/migrations.md](../../../../docs/migrations.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Existing single-file system tables are not silently migrated to split data planes; startup layout guard rejects legacy layout. Public upgrade guidance must state this and separately scoped migration plan rather than claim seamless 1.3→2.x migration. Configuration imports in migration tools execute trusted code. Tests present are not executed in this pass.

## Known Future Plans

User is open to clean automatic legacy migrator later; currently not required product commitment. Migration guide should point to data-plane upgrade task and exact supported migration tools.

## Navigation And Cross-Link Plan

The [system entrance](../../../backend/migrations/index.md), configuration and
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
