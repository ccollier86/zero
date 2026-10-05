---
id: zero.data-studio.tables
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: tables
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

# Logical Table Identity And Metadata

[Data Studio index](./index.md) · [Documentation index](../../index.md)

A DataStudioTable has tableId, immutable key, display name/description,
active/archived status, schema/schemaRevision, optimistic revision, rowCount
and timestamps. Catalog summaries omit the full schema; hydrate getTable when
an editor/automation needs it.

## Create And Address

The app-owned stable operation ID derives the logical table identity through
the service. Supply an explicit machine key for functions/workflows that need
stable addressing; a missing key is derived from the display name during create.

A later display rename does not rename key or move physical data.
getTable accepts tableId or key on the server service; the browser SDK follows
its published table-ID surface.

## Edit And Archive

updateTable requires expectedRevision and optional name/description/schema.
setTableStatus requires expectedRevision and active/archived.
SchemaRevision increments only when canonical schema changes; the overall
revision also tracks metadata/status changes.

Archived tables deny row mutations and schema changes rather than silently
erasing their contents. Archiving is not physical DELETE TABLE SQL or a content
backup. Re-activate through the status path with current authority/revision.

## Counts And Concurrency

rowCount updates in the same transaction as create/delete row and supports quota/
catalog correctness. It is not a count recomputed optimistically in a browser.

No-op metadata/schema update returns current state rather than inventing a new
schema history entry.
Conflicts require refreshing/reviewing current state, not forcing a raw update.

See [schemas](./schemas.md), [rows](./rows.md), [concurrency](./concurrency.md),
[HTTP API](./http-api.md) and [limits](./limits.md).
