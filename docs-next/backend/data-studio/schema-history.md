---
id: zero.data-studio.schema-history
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: schema-history
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Immutable Logical Schema Versions

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Every actual canonical schema change appends a version before moving the current
pointer in the same actor transaction. Metadata-only changes do not create an
extra schema version.

## What Is Versioned

Historical entries carry schemaVersionId, tableId, schemaRevision, schema and
createdAt. Current table schemaRevision refers to that logical schema evolution;
overall revision additionally changes for metadata/status.

History is bounded to256 schema versions per table.
listSchemaVersions is paged with limit and optional beforeRevision; the maximum
page is10, not an unbounded full history response.

## What Is Not Versioned

This is schema history, not automatic row-value time travel or a database branch.
Changing a schema does not duplicate every historical row value, restore deleted
records, or execute arbitrary migration functions stored in JSON.

Version1 is the schema **format** discriminator.
schemaRevision1/2/... is the history **revision** for a particular logical table.
Neither is the app's Fabric realm behavior version.

## Safe Evolution

The command checks current expectedRevision and actual column stats/row count
before admitting compatibility. An impossible writer-lane CAS miss rolls back
the whole transaction, including any newly appended history.

Use admitted update/status APIs and acknowledge their result.
Do not update the private history/catalog SQL directly from an app endpoint.

See [schemas](./schemas.md), [tables](./tables.md),
[concurrency](./concurrency.md), [limits](./limits.md) and
[Fabric realms](../fabric/realms.md).
