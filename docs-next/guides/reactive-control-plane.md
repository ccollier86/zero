---
id: zero.guides.reactive-control-plane
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: reactive-control-plane
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose A Reactive Control Plane

[Guides index](./index.md) · [Documentation index](../index.md)

Use the same data/action contracts across list, detail and edit screens.
The app supplies data source, columns, domain actions and placement. Zero supplies
query controls, scoped state, pending operations and reusable tokenized UI.

## Choose The Source First

Use an array for complete local data, a reactive collection for a complete live
cache, or a server query for server-controlled search/sort/pagination.
Do not treat a shared record cache as the membership of every query.

The built-in server table adapter uses Zero's authenticated transport. Cursor
pagination requires an app-specific adapter; unknown totals should not be
presented as an invented page count.

## Choose The Layout

DataTable handles a grid and reusable toolbar/action slots.
Master-detail combines the grid with a selected-record panel and bottom action
bar. CRUD/form components add schema-driven mutation controls.

Use action buttons for operations such as suspend/reset/publish. Put durable
record details, properties and roles in the detail panel. Domain-specific
control planes adapt permissions/modes rather than scattering giant standalone
cards for each operation.

## Keep Editing Truthful

Inline edits can remain visually quiet while still showing pending/error state.
The source operation must settle before the UI reports accepted success.
An onSuccess notification failure is not a failed server write and must not
offer an unsafe duplicate write retry.

Use page-scoped bulk selection unless a backend explicitly supports all matching
records. Selected IDs are UI state, not another actor's read/write authority.

## Preserve Scope And Styling

On organization/auth replacement clear old rows, selection, drafts, pending
presentation and overlays. Superseded requests cannot replace the new page.
Use semantic design tokens and shared search/controls rather than hardcoded
light/dark color assumptions or CSS reaching into private component internals.

See [DataTable](../frontend/data-controls/index.md),
[forms](../frontend/forms/index.md), [SDK data composition](../frontend/sdk/data-composition.md),
[Guardian controls](../frontend/guardian/index.md) and
[scope transitions](../frontend/runtime/scope-transitions.md).
