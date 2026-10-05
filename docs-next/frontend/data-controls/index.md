---
id: zero.frontend.data-controls
type: index
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: overview
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reusable Data Control Planes

[Frontend index](../index.md) · [Documentation index](../../index.md)

Zero's data organisms compose schema-aware presentation, source-aware queries,
accepted mutation lifecycle and configurable actions. The application chooses
its records/columns/actions; it should not rebuild auth transport or routine
table control behavior for each screen.

## Table Foundation

- [DataTable](./data-table/index.md) covers the shared table organism, arrays,
  reactive collections, isolated server pages and public extension points.
- [MasterDetail](./master-detail.md) combines a selected-record panel, generated
  detail form and compact bottom action/navigation bar.
- [CrudPage](./crud-page.md) adds accepted create/edit/delete workflows in table
  and master-detail layouts.
- [Kanban](./kanban.md) documents controlled moves, card composition and pure
  projection helpers without inventing an awaited writer.
- [Configuration](./configuration.md) explains system-level composition and
  links exact table settings.
- [Roadmap](./roadmap.md) separates future data/editor ideas from existing controls.

The [Data Studio companion](../data-studio/index.md) documents logical table/schema
management and revisioned record controls. These internal drafts remain
subject to independent source/example/artifact qualification.

## Integration And Ownership

[Schema](../../backend/schema/index.md) supplies field metadata, logical validation,
codecs and primary keys. [SDK collections/resources](../sdk/index.md) provide normal
authenticated writes/queries. [Forms](../forms/index.md) supply detail editing.
Server resource/Guardian/Fabric contracts remain final authority.

Search/sort/page controls have one interaction state but different execution
owners by source. Accepted server page membership is not every row in a shared
cache. Actions wait for the writer/refresh; stale scope completion cannot finish
a replacement organization's control plane.

The inspected design favors compact shared search-first toolbars, token-based
primitives, explicit row identity and honest accepted writes. A hidden action or
selected page is not a backend permission or an implicit all-results operation.
