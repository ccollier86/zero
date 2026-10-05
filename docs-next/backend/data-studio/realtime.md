---
id: zero.data-studio.realtime
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: realtime
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

# Read-Only Reconciliation, Not Raw Cell CRUD

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Official client tables expose lightweight table/row reconciliation metadata.
Catalog uses full loading, row metadata lazy loading.
Canonical schemas and full row values use the dedicated byte-bounded API.

## Resource Boundary

The official resources allow only list/get for public reconciliation.
Private cell/schema-version/column-stat tables are internal.
Raw browser Sync mutation of those backing tables is rejected; it is not an
alternate row-edit path around schema/revision/permission commands.

Field projection removes full schema/value payloads from lightweight catalog/row
events. A table subscription does not reveal private internal cells by itself.

## Live Query Handling

Admitted Sync events invalidate or update scoped cached details/pages as
appropriate. Changed rows can affect ordering, filters and page membership,
so a scoped refetch may be required rather than merging every cached record.

Each query owns its ordered result set independently of the shared cache.
Foreign query records must not appear just because another component loaded them.

The packaged progressive workspace rebuilds the already-loaded prefix on admitted
reactive changes and accepted writes; it does not join new values into arbitrary
cache membership. Rebuilt bounded batches must share the same read sequence and
are published together. When a continuation's sequence changes, the old coherent
window remains visible but continuation/editing is blocked until refresh.
See the [controller contract](../../frontend/data-studio/controller.md) for exact
reset, cancellation, retry and selection behavior.

## Scope And Readiness

Fabric sources have per-database sequence/snapshot history and live membership/
credential fences. Scope change clears old catalog/details/pages and suppresses
late requests.
Target provision/projection must pass before ready data is released.

This isn't a generic realtime schema DDL protocol or permission to expose
internal Resource tables. See [Fabric realtime](../fabric/realtime.md),
[resources](../resources/sync-integration.md),
[queries](./queries.md), [installation](./installation.md) and
[frontend integration](./frontend-integration.md).
