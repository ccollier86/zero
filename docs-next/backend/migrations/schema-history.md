---
id: zero.migrations.history
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: history
maturity: supported
applies_to: ["2.1.1 baseline with unreleased handler/planning corrections"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Inspect Schema Snapshots And History

[Migrations index](./index.md) · [Documentation index](../../index.md)

The public migration surface exports SchemaHistory, inspectDatabaseSchema,
snapshotDeclaredTables, hashSchemaSnapshot and diffSchemaSnapshots.

## Intended Versus Installed

snapshotDeclaredTables normalizes admitted declarations into a deterministic
schema snapshot: columns, identity/primary-key metadata and declared indexes.
inspectDatabaseSchema reads the actual SQLite schema, including its column/index
structure and constraints relevant to comparison.

Normalization preserves quoted SQL literal differences. A whitespace/comment
change is not always the same thing as a changed default expression; planner
classification uses admitted grammar rather than substring guesses.

## Stored History

SchemaHistory records snapshots after successful migration events in
_zero_schema_history, with migration version, up/down direction, schema hash,
serialized schema and creation time.
latest returns the newest stored record or null.

The migration ledger separately records successful and failed attempts.
A failed attempt does not become a successful schema history entry.
History does not automatically contain every raw app DDL operation done outside
the migrator.

## Privileged API Boundary

Constructing SchemaHistory or MigrationLedger can create their own internal
tables. These are trusted operational helpers, not inherently non-mutating
diagnostic wrappers.

The application schema CLI inspection path deliberately opens the chosen app DB
readonly and does not install system migration/history tables there.
Use the supported [CLI target](./cli.md), not manual helper construction, when
that read-only contract is required.

Snapshots/hashes describe one database, not a cross-file global catalog or a
proof that every deployment artifact includes the same imported handler code.

See [Doctor](./doctor.md), [planning](./planning.md),
[data planes](./data-planes.md) and [registries](./registries.md).
