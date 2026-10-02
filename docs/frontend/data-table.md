# DataTableView

`DataTableView` is Zero's schema-aware table organism. It is built on
TanStack Table and Zero's schema metadata, so most data-driven CRUD screens can
be wired with a schema plus a source.

`DataTable` remains as a backwards-compatible alias. New app code should prefer
`DataTableView` because it names the component by role instead of implementation.

## Fast Path

```tsx
import { DataTableView } from '@zero/framework/react';
import { todoTable } from '@app/lib/schema';

export function TodoTable() {
  return (
    <DataTableView
      schema={todoTable.schema}
      collection="todos"
      columns={['title', 'priority', 'done']}
      editable={['title', 'priority', 'done']}
      searchable
      sortable
      filterable
      paginated={{ pageSize: 25 }}
      exportFilename="todos.csv"
    />
  );
}
```

When `collection` is provided, the table subscribes through the SDK collection
store and inline edits write back through the same optimistic collection API.
The component must be rendered under `AppProvider` or `ClientProvider`.

## Source Modes

### Full-Sync Collection

Use full-sync collection mode for normal app tables that should be live in the
browser.

```tsx
<DataTableView schema={clientTable.schema} collection="clients" />
```

This is the fastest default path. It uses the same `client.collection(table)`
source as `useCollection()`, including auth headers, reconnect behavior, and
optimistic mutation state.

For registered resources, full-sync mode respects resource `list` policy.
Unconstrained policies use the normal fast path; owner-only or otherwise
row-constrained policies use per-connection row-filtered snapshots and live
changes.

### Lazy Backend Reads

Use lazy mode for large tables or filtered history/audit views that should not
be included in startup snapshots.

```tsx
<DataTableView
  schema={auditLogTable.schema}
  source={{
    type: 'lazy',
    table: 'audit_log',
    filters: { user_id: userId, severity: 'warning' },
    options: { order: 'created_at', dir: 'desc', limit: 100 },
  }}
  columns={['created_at', 'event', 'severity']}
  searchable
  filterable
/>
```

Lazy mode reads `/api/data` through the frontend SDK client, so authenticated
apps reuse the normal auth/refresh transport path. Registered resource `list`
policy is enforced server-side for lazy tables before rows are returned. Rows
returned from `/api/data` are loaded into the table's collection store; future
live changes for those rows can continue to flow through sync without forcing
the whole table into a snapshot.

The helper `buildDataTableLazyQuery(table, filters, options)` is exported for
tests and advanced custom sources.

### Caller-Owned Rows

Use `data` when the caller owns the data lifecycle.

```tsx
<DataTableView
  schema={reportSchema}
  data={rows}
  columns={['name', 'total', 'status']}
  onCellEdit={(id, field, value) => saveCell(id, { [field]: value })}
/>
```

### Custom Source Object

Use `source={{ type: 'data' }}` when the caller wants to expose loading,
errors, refresh, or mutation actions through the same DataTable contract.

```tsx
<DataTableView
  schema={reportSchema}
  source={{
    type: 'data',
    data: rows,
    isLoading,
    error,
    refresh,
    actions: {
      update: (id, changes) => saveRow(id, changes),
    },
  }}
  editable={['status']}
/>
```

## Primary Keys

DataTable row identity uses `schema.primaryKey` by default. Override it only
when the view intentionally needs a different stable key.

```tsx
<DataTableView schema={invoiceTable.schema} collection="invoices" primaryKey="invoice_id" />
```

Selection IDs, highlighted row IDs, inline edit IDs, and row action callbacks
all use that resolved primary key. The component no longer assumes `row.id`.

Inline edits encode values with schema field codecs before writing to a
collection. For example, tag fields can edit as arrays while storing their
canonical database representation.

## Columns

`columns` controls order and visibility for the initial table definition.

```tsx
<DataTableView
  schema={clientTable.schema}
  collection="clients"
  columns={['name', 'status', 'last_contacted_at']}
/>
```

Use `columnOverrides` when schema metadata is close but a specific column needs
custom rendering or behavior.

```tsx
<DataTableView
  schema={clientTable.schema}
  collection="clients"
  columnOverrides={{
    status: {
      header: 'Status',
      width: 140,
      cell: ({ value }) => <StatusBadge status={String(value)} />,
    },
    last_contacted_at: {
      header: 'Last Contact',
      sortable: true,
      filterable: false,
    },
  }}
/>
```

Override options:

| Option | Purpose |
| --- | --- |
| `header` | Label rendered in the column header |
| `cell` | Custom read renderer receiving row, value, column id, and field metadata |
| `width` | TanStack column width |
| `sortable` | Enable or disable sorting for the column |
| `filterable` | Enable or disable generated column filtering |
| `editable` | Enable or disable inline editing for the column |

## Toolbar

The toolbar is a responsive, table-scoped control plane. It can compose the
compact search, generated field filters, arbitrary app controls, bulk actions,
column visibility, CSV export, active-filter feedback, and supplemental status
content without requiring a custom table wrapper.

```tsx
<DataTableView
  schema={clientTable.schema}
  collection="clients"
  searchable={{
    placeholder: 'Find clients…',
    ariaLabel: 'Search clients',
    collapsedWidth: 128,
    expandedWidth: 260,
  }}
  filterable
  filterColumns={['status', 'department']}
  toolbarLabel="Client table controls"
  toolbarSlots={{
    actions: <Button onClick={openCreate}>New Client</Button>,
  }}
  exportFilename="clients.csv"
/>
```

Toolbar behavior:

| Prop | Behavior |
| --- | --- |
| `searchable` | `true` shows the compact table search; an options object customizes it; omitted/`false` hides it |
| `filterable` | Shows schema-aware, client-side per-column filter controls |
| `filterColumns` | Limits generated filters to specific columns |
| `toolbarSlots` | Adds `controls`, `actions`, and `supplemental` content as nodes or table-aware render functions |
| `toolbarLabel` | Sets the accessible name for the toolbar control group; defaults to `Table controls` |
| `toolbarActions` | Legacy right-side action outlet; prefer `toolbarSlots.actions` in new code |
| `showToolbar` | Forces toolbar rendering when only export/columns/actions are needed |
| `showExport` | Shows or hides the CSV export action |
| `showColumnVisibility` | Shows or hides the column visibility dropdown |

Generated filters understand common field types such as boolean, select, enum,
combobox, number, date, and text. Discrete, numeric, and date controls match
exact values; text controls use contains matching; multi-value fields match an
included value. Search, generated filters, and any toolbar slot make the
toolbar render automatically. `showToolbar` is still useful when the table
should expose only the built-in Columns or Export controls.

### Compact Table Search

`searchable` accepts `true` or `DataTableSearchOptions`:

```ts
interface DataTableSearchOptions {
  placeholder?: string;
  ariaLabel?: string;
  collapsedWidth?: number;
  expandedWidth?: number;
  disabled?: boolean;
}
```

The Gooey-inspired control expands when focused and remains expanded while it
contains a query. It is deliberately local to DataTable; it does not change
Zero's normal `Input`, admin search fields, auth controls, or other app search
experiences.

- `Escape` clears a populated query. Pressing it again while the query is
  empty blurs and collapses the control.
- `Enter` is consumed by the searchbox so a table search nested in a form does
  not accidentally submit that form.
- The input remains a labeled `searchbox`, exposes a dedicated clear button,
  and keeps the standard Zero focus ring.
- Users who prefer reduced motion get an immediate geometry change instead of
  the spring transition.
- Custom widths are pixel values. The control still caps itself at the
  available width, and the surrounding toolbar wraps on narrow screens.

Use `DataTableSearch` directly only when composing a low-level custom table
toolbar. `DataTableView` owns its value and filtering behavior when configured
through `searchable`. `DataTableView` defaults search off; the low-level
`DataTableToolbar` defaults its own `searchable` prop on.

### Toolbar Slots And Context

`toolbarSlots` has three stable insertion points:

| Slot | Placement and intended use |
| --- | --- |
| `controls` | Beside search and generated filters; selects, filter popovers, or view controls |
| `actions` | Before the built-in Columns and Export buttons; create, bulk, or table-level actions |
| `supplemental` | Full-width row below the primary controls; selection summaries or contextual help |

Every slot accepts a React node or a render function. Render functions receive
the same table-local context:

| Context field | Meaning |
| --- | --- |
| `table` | TanStack `Table<TData>` instance for advanced table controls |
| `query` / `setQuery` | Current global search query and its setter |
| `columnFilters` | Current TanStack column-filter state |
| `activeFilterCount` | Number of active column filters, excluding global search |
| `hasActiveFilters` | Whether at least one column filter is active |
| `hasActiveSearch` | Whether the global search query is non-empty |
| `clearAll` | Clears global search and all client-side column filters |
| `selectedRowIds` | IDs of the currently selected TanStack rows |
| `selectedRows` | Original values for the currently selected rows |
| `selectedRowCount` | Number of selected rows |

When composing `DataTableToolbar` directly, pass the same object as `slots`
and the accessible group name as `ariaLabel`. `DataTableView` exposes those
low-level props as `toolbarSlots` and `toolbarLabel`.

This example uses Zero's official Select, the public Popover path, and a bulk
action driven by the live selection context:

```tsx
import {
  Button,
  DataTableView,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@zero/framework/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@zero/framework/components/popover';

<DataTableView<ClientRow>
  schema={clientTable.schema}
  collection="clients"
  selectable
  searchable={{ ariaLabel: 'Search clients' }}
  toolbarLabel="Client table controls"
  toolbarSlots={{
    controls: ({ table }) => {
      const department = table.getColumn('department');
      return (
        <>
          <Select
            value={String(department?.getFilterValue() ?? 'all')}
            onValueChange={(value) => {
              department?.setFilterValue(value === 'all' ? undefined : value);
            }}
          >
            <SelectTrigger className="h-8 w-40" aria-label="Department">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              <SelectItem value="clinical">Clinical</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                More filters
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2">
              <p className="text-sm text-muted-foreground">
                Focus this view on records that need review.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  table.getColumn('needs_review')?.setFilterValue(true);
                }}
              >
                Needs review
              </Button>
            </PopoverContent>
          </Popover>
        </>
      );
    },
    actions: ({ selectedRowIds, selectedRowCount }) => (
      <Button
        type="button"
        size="sm"
        disabled={selectedRowCount === 0}
        onClick={() => archiveClients([...selectedRowIds])}
      >
        Archive selected ({selectedRowCount})
      </Button>
    ),
    supplemental: ({ selectedRowCount }) => selectedRowCount > 0 ? (
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {selectedRowCount} selected
      </span>
    ) : null,
  }}
/>
```

The toolbar stacks its control and action groups on small screens and lets each
group wrap before returning to a single aligned row at the `sm` breakpoint.
Keep custom controls labeled, use `type="button"` for non-submit actions, and
use token classes such as `background`, `foreground`, `muted-foreground`,
`border`, and `ring` rather than fixed light/dark colors.

### Client Toolbar Filters Versus Server Filters

Toolbar search, generated filters, and slot controls that call TanStack column
APIs filter the rows already resolved into the table. They do not rewrite or
refetch a lazy source. `clearAll` likewise clears only the global search and
client-side column filters.

By contrast, `filters` on a lazy DataTable and `source.filters` on a
`source={{ type: 'lazy' }}` object are sent to `/api/data` and bound the server
query. For large or security-sensitive result sets, keep the server-filter
state in the parent, pass it into the lazy source, and let a `controls` slot
update that state. Use toolbar filters for refining the rows that have already
been loaded; use lazy source filters for deciding which rows are loaded at all.

### Wrapper Components

`CrudPage`, `MasterDetailView`, and `MasterDetailPage` accept
`tableToolbarSlots` and forward it to their generated DataTable. Set
`tableToolbarLabel` when the default `Table controls` accessible name is not
specific enough. Their `searchable` prop also accepts the same
`boolean | DataTableSearchOptions` contract. `CrudPage.toolbar` remains
page-header content beside its Create action; it is not a table-toolbar slot.

## Upgrading Existing Tables

This toolbar upgrade is additive. Existing apps do **not** need to rewrite each
table or page:

- `DataTable` remains an alias of `DataTableView`; both names and their existing
  data, collection, lazy-source, column, edit, selection, pagination, and row
  action props keep working.
- `searchable` still accepts the existing boolean form. `searchable` keeps
  search enabled, and omitting it or passing `false` keeps search disabled. The
  compact expanding presentation is the visible upgrade to enabled table
  search.
- Existing `toolbarActions={<... />}` and `toolbarActions={(context) => ...}`
  calls continue to render in the right-side action group before Columns and
  Export. Moving them to `toolbarSlots.actions` is optional.
- `toolbarSlots`, `toolbarLabel`, `tableToolbarSlots`, and
  `tableToolbarLabel` are optional additions. Apps that do not pass them retain
  their prior component structure.
- No ReactiveDB/schema migration, backend route change, or data rewrite is
  required. Updating the framework package is sufficient for package-mode
  components.

For example, this existing table remains valid without modification:

```tsx
<DataTable
  schema={clientTable.schema}
  collection="clients"
  searchable
  toolbarActions={<Button onClick={openCreate}>New Client</Button>}
/>
```

Two upgrade details are worth reviewing:

1. Enabled table search now uses the compact, animated presentation documented
   above. Search value ownership and client-side filtering are unchanged.
2. Generated boolean, select, enum, numeric, date, and datetime filters now use
   exact scalar matching. This fixes the prior numeric scalar/range mismatch.
   Apps that deliberately injected TanStack range tuples into schema-generated
   numeric filters should compose `useDataTable()` directly for that custom
   range behavior.

If an app previously copied the table source with
`zero add components/data-table`, the app owns that local copy and a package
update intentionally does not overwrite it. Keep the local implementation as
is, manually port the desired toolbar files, or review and then run
`zero add components/data-table --force`. The `--force` form replaces local
component files, so do not use it over app-specific edits without first
reviewing the diff.

## Selection And Row Actions

```tsx
<DataTableView
  schema={contactTable.schema}
  collection="contacts"
  selectable
  onSelectionChange={(ids) => setSelectedContactIds(ids)}
  onRowClick={(row) => setFocusedContact(row)}
  onRowDoubleClick={(row) => openContact(row)}
  highlightedRowId={focusedContactId}
  actions={[
    { label: 'Edit', icon: Pencil, onClick: openEditor },
    { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: confirmDelete },
  ]}
/>
```

Selection checkboxes and row action cells stop row-click propagation so they can
be used safely inside master-detail layouts.

## Loading, Error, And Empty States

```tsx
<DataTableView
  schema={auditLogTable.schema}
  source={{ type: 'lazy', table: 'audit_log', options: { limit: 100 } }}
  loadingState={<AuditLogSkeleton />}
  errorState={(error, retry) => <RetryNotice error={error} onRetry={retry} />}
  emptyState={<p>No audit events match the current filters.</p>}
/>
```

Lazy and custom data sources can surface loading and error states. Full-sync
collections usually render immediately from the client store.

## State Control

`initialState` seeds TanStack table state without forcing the caller to own all
table state.

```tsx
<DataTableView
  schema={orderTable.schema}
  collection="orders"
  initialState={{
    sorting: [{ id: 'created_at', desc: true }],
    pagination: { pageIndex: 0, pageSize: 50 },
    columnVisibility: { internal_notes: false },
  }}
/>
```

For deeper control, compose the exported subcomponents and `useDataTable()`
directly.

## Public Exports

```ts
import {
  DataTableView,
  DataTable,
  DataTableSearch,
  DataTableToolbar,
  DataTablePagination,
  DataTableRowActions,
  DataTableColumnHeader,
  useDataTable,
  useDataTableSource,
  buildDataTableLazyQuery,
} from '@zero/framework/react';
```

Important types:

```ts
import type {
  DataTableProps,
  DataTableSource,
  DataTableSourceActions,
  DataTableSourceState,
  DataTableColumnOverride,
  DataTableColumnOverrides,
  DataTableInitialState,
  DataTableFilters,
  DataTableSearchOptions,
  DataTableSearchProps,
  DataTableToolbarContext,
  DataTableToolbarProps,
  DataTableToolbarSlot,
  DataTableToolbarSlots,
  RowAction,
} from '@zero/framework/react';
```
