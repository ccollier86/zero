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
applies_to: ["2.6.0 baseline with unreleased working-tree additions"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "5aa2a34a47c7bc05b0c6f01849fdbf477dc01ea8"
  snapshot: dirty
  date: "2026-10-07"
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
- [Motion and live updates](./motion-and-live-updates.md): tuned row/page/loading
  motion, held genuine arrivals, counters, opt-outs and reduced motion.
- [State and columns](./state-and-columns.md): controlled facets, first-row
  page-size anchoring, cursor reset boundaries, headless hook and stable sizing.
- [Controls](./controls.md): search-first toolbars, slots, filters and honest paging.
- [Editing](./editing.md): writer precedence, encoded values and accepted cells.
- [Actions](./actions.md): pending/confirmation/refresh and row/bulk targets.
- [Selection and export](./export-and-selection.md): current-page action scope,
  loaded server exports and literal spreadsheet-safe text.
- [Roadmap](./roadmap.md): relevant future proposals, not invented source modes.

These pages describe the Zero 2.6 table family plus explicitly labeled current
working-tree motion/cache/live additions, not a claim that those additions have
already shipped. Each guide records its own
evidence level; a shared API reference does not qualify every application source
or device combination.

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
The working tree also exports DataTableNewRecordsButton and the readonly
DATA_TABLE_MOTION defaults; ordinary DataTable compositions need neither manually.
Use exact per-feature imports; internal controller/view extraction does not
introduce new application-facing hooks.

[Schema codecs](../../../backend/schema/codecs.md) bridge logical editors and
wire rows. [SDK](../../sdk/index.md) owns auth/receipts; server policy owns field/
tenant/query permission. A disabled button, search field or current-page selection
does not authorize a write or every matching backend result.

## Verification

Test the intended source, query ordering, no double pagination, unknown totals,
scope/source replacement and delayed/rejected actions. Focused actual table and
MasterDetail browser regressions support their inspected source contracts.
Working-source checks for the additions are distinct from release qualification.
Qualify the consuming application's server contracts, production styling and
accessibility separately; shared regressions do not authorize custom writers.
