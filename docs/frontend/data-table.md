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

The toolbar is composable. It can show search, field filters, column
visibility, CSV export, and caller-provided actions independently.

```tsx
<DataTableView
  schema={clientTable.schema}
  collection="clients"
  searchable
  filterable
  filterColumns={['status', 'department']}
  toolbarActions={<Button onClick={openCreate}>New Client</Button>}
  exportFilename="clients.csv"
/>
```

Toolbar behavior:

| Prop | Behavior |
| --- | --- |
| `searchable` | Shows the global search input |
| `filterable` | Shows schema-aware per-column filter controls |
| `filterColumns` | Limits generated filters to specific columns |
| `toolbarActions` | Renders app-provided controls in the toolbar |
| `showToolbar` | Forces toolbar rendering when only export/columns/actions are needed |
| `showExport` | Shows or hides the CSV export action |
| `showColumnVisibility` | Shows or hides the column visibility dropdown |

Generated filters understand common field types such as boolean, select, enum,
combobox, number, date, and text.

## Selection And Row Actions

```tsx
<DataTableView
  schema={userTable.schema}
  collection="users"
  selectable
  onSelectionChange={(ids) => setSelectedUserIds(ids)}
  onRowClick={(row) => setFocusedUser(row)}
  onRowDoubleClick={(row) => openUser(row)}
  highlightedRowId={focusedUserId}
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
  RowAction,
} from '@zero/framework/react';
```
