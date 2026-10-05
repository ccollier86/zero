---
id: zero.frontend.data-controls.data-table
type: index
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# DataTable: One Control Surface, Several Sources

[Data controls index](../index.md) · [Documentation index](../../../index.md)

DataTable and its alias DataTableView compose schema-aware columns, built-in
search/sort/page controls, source resolution and accepted mutation lifecycle.
An app selects source, columns and actions rather than duplicating those controls.

## Core Reference

- [Configuration](./configuration.md): every table prop/default and source-dependent
  behavior, without mixing headless/toolbar/organism defaults.
- [Sources](./sources.md): arrays, complete collections, demand-loaded collections
  and isolated server results.
- [Server sources](./server-sources.md): query/result contract, offset/cursor paging,
  authenticated adapter, ordering and authority fences.
- [State and columns](./state-and-columns.md): controlled facets, headless hook,
  schema metadata and stable sizing.
- [Controls](./controls.md): search-first toolbars, slots, filters and honest paging.
- [Editing](./editing.md): writer precedence, encoded values and accepted cells.
- [Actions](./actions.md): pending/confirmation/refresh and row/bulk targets.
- [Selection and export](./export-and-selection.md): current-page action scope,
  loaded server exports and literal spreadsheet-safe text.
- [Roadmap](./roadmap.md): relevant future proposals, not invented source modes.

These pages cover the table family as inspected in working source; independent
manual review and installed-package qualification remain separate gates.

## Minimal Local Fragment

```tsx
import { DataTable } from '@zero/framework/react';

<DataTable
  schema={tasks.schema}
  data={rows}
  columns={['title', 'done']}
  searchable={{ fields: ['title'], placeholder: 'Find tasks…' }}
  paginated={{ pageSize: 20 }}
/>;
```

tasks/rows are the app's descriptor and stored row data. This fragment adds no
backend route or write permission. The same controls can drive a server source:

```tsx
<DataTable
  schema={tasks.schema}
  source={{ type: 'server', table: 'tasks' }}
  columns={['title', 'done']}
  searchable={{ fields: ['title'], placeholder: 'Find tasks…' }}
  paginated={{ pageSize: 20 }}
/>;
```

The built-in server adapter requires the normal configured client and an admitted
/api/data table/resource. Its controls query the server; accepted rows are not
filtered/paginated a second time in the browser. Exact totals are optional.

## Public Imports And Boundaries

DataTable/DataTableView and their common types are available from the browser-safe
React/root barrel. The @zero/framework/components/data-table subpath exposes
additional table primitives/hooks/helpers, including EditableCell/AnimatedCell.
Use exact per-feature imports; internal controller/view extraction does not
introduce new application-facing hooks.

[Schema codecs](../../../backend/schema/codecs.md) bridge logical editors and
wire rows. [SDK](../../sdk/index.md) owns auth/receipts; server policy owns field/
tenant/query permission. A disabled button, search field or current-page selection
does not authorize a write or every matching backend result.

## Verification

Test the intended source, query ordering, no double pagination, unknown totals,
scope/source replacement and delayed/rejected actions. Focused actual table and
MasterDetail browser regressions support the corrected working source. Package,
production styles/accessibility and app-specific server contracts still require
their separate review gates.
