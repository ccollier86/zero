---
id: zero.data-studio.frontend
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: frontend
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

# Editor, SDK And Adaptive Permissions

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Use the prefab DataStudio workspace or compose its controller/grid/inspector/
toolbar/dialog/cell helpers. These use existing DataTable/list-detail/action-bar
and semantic design tokens, not an unrelated management UI.

Detailed props/controller boundaries belong to the
[frontend Data Studio family](../../frontend/data-studio/index.md).

## SDK

Client.dataStudio supplies authenticated scope-fenced catalog/schema/row/history
operations and reconciliation caches. It is not a direct raw SQL client.
Mutations accept stable operation IDs via options; row/table edits need actual
expectedRevision.

Capabilities decide read/write/manage display. An ordinary organization manager
and an Administration Organization app member use the same control plane within
their granted scope.

## Inline Editing

Editing uses a complete value map for row replacement, preserving other cells.
Pending acceptance, revision conflicts, safe validation errors and stale-scope
suppression are first-class states.
Do not replace a canonical empty/null/missing value with a guessed default on
every display render.

Each page owns its ordered membership independently of the shared cache.
Changing search/filter/order resets paging and retires obsolete queries.

## Schema UX

Show current schema and stable IDs/keys separately from labels/order.
Schema compatibility failures have meaningful current-row context; do not
advertise destructive automatic casts/backfills that the server rejects.

Apps choose where to mount components or can build their own UI, while keeping
the official service/SDK boundary.
See [schemas](./schemas.md), [rows](./rows.md), [queries](./queries.md),
[permissions](./permissions.md) and [realtime](./realtime.md).
