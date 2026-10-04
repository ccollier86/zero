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

### Isolated Server Queries

Use a server source when search, filters, sorting, and pagination must execute
against the complete server-side result set instead of the rows already held in
the browser. Server pages stay isolated from ReactiveDB's shared collection
store, so changing a query cannot leak rows into another table or authorization
scope.

The built-in offset adapter uses Zero's authenticated `/api/data` route:

```tsx
<DataTableView
  schema={auditLogTable.schema}
  source={{
    type: 'server',
    table: 'audit_log',
    pagination: 'offset',
  }}
  columns={['created_at', 'actor', 'event', 'severity']}
  searchable={{
    fields: ['actor', 'event'],
    placeholder: 'Search audit events…',
  }}
  filterable
  sortable
  paginated={{ pageSize: 50 }}
/>
```

The table projects its controlled interaction state into one
`DataTableServerQuery`:

```ts
interface DataTableServerQuery {
  search: string;
  searchFields?: string[];
  filters: ColumnFiltersState;
  sorting: SortingState;
  pagination: {
    mode: 'offset' | 'cursor';
    pageIndex: number;
    pageSize: number;
    cursor?: string | null;
  };
}
```

The built-in adapter validates table/column identifiers, encodes the query with
`buildDataTableServerQuery()`, and sends it through the normal Zero client. The
server still enforces the table's Resource exposure, list policy, tenant realm,
and row constraints. A browser-supplied table name, filter, or active tenant is
never an authority boundary.

Exact totals are optional. `hasMore` controls Next when a count is unavailable,
and the footer shows the loaded range without inventing a total or last page.
This lets an endpoint avoid an extra count query:

```ts
return {
  rows,
  page: {
    mode: 'offset',
    offset,
    hasMore: rows.length === pageSize,
    // total may be omitted
  },
};
```

Cursor pagination requires an app-owned adapter. Cursors are opaque, are learned
only from accepted responses, and are retained only for pages the current query
has visited:

```tsx
const orderRowId = (row: OrderRow) => row.orderNumber;

// Define once at module scope, or memoize against the stable SDK client.
const ordersAdapter: DataTableServerAdapter<OrderRow> = {
  query(query, { signal }) {
    return client.fetch<DataTableServerResult<OrderRow>>('/api/orders/search', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    });
  },
};

<DataTableView
  schema={orderTable.schema}
  source={{
    type: 'server',
    table: 'orders',
    pagination: 'cursor',
    adapter: ordersAdapter,
    getRowId: orderRowId,
  }}
  searchable={{ fields: ['customerName', 'orderNumber'] }}
  paginated={{ pageSize: 50 }}
/>
```

A custom adapter must honor `context.signal` and return a result whose page mode
matches the source. Zero validates and snapshots the result before displaying
it. Replacing the adapter, row-identity function, query, login, tenant, or
authorization-data boundary immediately retires the old page; aborted or
out-of-order responses cannot repopulate it.

`live` defaults to `true`. When the named table is also in the current Sync
catalog, collection changes act only as an invalidation signal and cause a new
server query; server rows are still never loaded into that collection. Set
`live: false` for manually refreshed result sets. Logical/custom server tables
that are not in the Sync catalog remain read-only unless the app supplies
`onCellCommit`, row actions, or another explicit mutation path.

Server mode differs from lazy mode in one important way:

- `lazy` performs a bounded backend read, then hydrates those rows into the
  shared collection so they can receive later Sync changes.
- `server` owns an isolated page and reruns its server query when table controls
  change. It is the appropriate mode for large directories and cursor APIs.

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

Source mutation functions may return `void` for legacy synchronous adapters or
a `Promise<void>` for authoritative async writes. The built-in collection source
uses the acknowledged `Collection.insertAsync()`, `updateAsync()`, and
`removeAsync()` methods, so pending UI does not report success until the exact
Sync mutation reference is accepted by the server.

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

For a server source whose rows do not expose the schema primary key, use the
source-local `getRowId(row, index)` override shown above. It must produce a
non-empty, unique string or number for every accepted page. Zero rejects an
invalid or duplicate identity instead of allowing selection or mutations to
target the wrong row.

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
      minWidth: 112,
      maxWidth: 180,
      truncate: true,
      cell: ({ value }) => <StatusBadge status={String(value)} />,
    },
    customer_name: {
      header: 'Customer',
      flex: true,
      wrap: true,
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
| `minWidth` / `maxWidth` | Bounds used by TanStack sizing |
| `flex` | Lets the column consume remaining space in a fixed-layout table |
| `wrap` | Allows multi-line content with safe word breaking |
| `truncate` | Keeps non-editing content to one clipped line with an ellipsis |
| `sortable` | Enable or disable sorting for the column |
| `filterable` | Enable or disable generated column filtering |
| `editable` | Enable or disable inline editing for the column |

Set `tableLayout="fixed"` when predictable geometry matters. Non-flex columns
use their resolved width while `flex` columns share the remaining space.
`truncate` and `wrap` are explicit so long secrets, URLs, and generated text do
not silently change the layout policy for every table.

## Toolbar

The toolbar is a responsive, table-scoped control plane. It can compose the
compact search, generated field filters, arbitrary app controls, bulk actions,
column visibility, CSV export, active-filter feedback, and supplemental status
content without requiring a custom table wrapper.

### Upgrade Compatibility

Existing DataTable call sites do not need to be rewritten for this toolbar
upgrade. The existing `DataTable` alias, `searchable` boolean,
`toolbarActions`, `showToolbar`, `showExport`, and `showColumnVisibility`
contracts remain supported. `toolbarSlots` and `toolbarLabel` are optional
additions, and the reusable `DataTableControls` shell is additive: an app that
does not use them does not need placeholder values or new wrapper code. No
database or schema migration is involved.

When an existing table already uses `searchable`, it keeps the same client-side
global-filter behavior and receives the compact table-only presentation. When
it already uses `toolbarActions`, that content stays in the right-side action
group. Apps can adopt slots incrementally; if `toolbarSlots.actions` and
`toolbarActions` are both present, the slot renders first and the existing
outlet follows it before the built-in Columns and Export buttons.

Two upgrade details are worth reviewing:

1. Generated boolean, select, enum, numeric, date, and datetime filters now use
   exact scalar matching. This fixes the prior numeric scalar/range mismatch.
   An app that deliberately passes TanStack range tuples should compose
   `useDataTable()` directly for that custom range behavior.
2. An app that previously copied the table implementation with
   `zero add components/data-table` owns that local source. Updating the
   framework package intentionally does not overwrite it. Keep the local
   implementation, port the desired toolbar files manually, or review local
   changes before running `zero add components/data-table --force`; `--force`
   replaces the copied component files.

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
| `toolbarActions` | Existing right-side action outlet; remains supported with no rewrite; prefer `toolbarSlots.actions` in new code |
| `showToolbar` | Forces toolbar rendering when only export/columns/actions are needed |
| `showExport` | Shows or hides the CSV export action |
| `showColumnVisibility` | Shows or hides the column visibility dropdown |

Generated filters understand common field types and apply these client-side
TanStack matching rules:

| Schema field | Generated match |
| --- | --- |
| `boolean`, `select`, `enum`, single-value `combobox` | Exact value |
| `number`, `date`, `datetime` | Exact value |
| `multiSelect`, `tags`, multiple `combobox` | Row array includes the selected/filter value |
| Text and other fallback fields | Contains text |

Search, generated filters, and any non-empty toolbar slot make the toolbar
render automatically. `showToolbar` is still useful when the table should
expose only the built-in Columns or Export controls.

### Compact Table Search

`searchable` accepts `true` or `DataTableSearchOptions`:

```ts
interface DataTableSearchOptions {
  fields?: string[];
  placeholder?: string;
  ariaLabel?: string;
  collapsedWidth?: number;
  expandedWidth?: number;
  disabled?: boolean;
}
```

`fields` selects columns searched by the built-in server adapter. Local and
lazy tables continue to use TanStack's client-side global filter. In server
mode, a non-empty search without at least one safe search field is rejected
instead of issuing an unconstrained or ambiguous query. When `fields` is
omitted, DataTable derives it from visible text, email, URL, and textarea schema
fields.

The control expands when focused and remains expanded while it contains a
query. Its icon and input use a gooey joined-surface animation. It is scoped to
table and management-directory toolbars; it does not change Zero's normal
`Input` or general application search fields.

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

Use `DataTableSearch` directly when composing a low-level custom table or
server-backed directory toolbar. `DataTableView` owns its value and filtering
behavior when configured through `searchable`. `DataTableView` defaults search
off; the low-level `DataTableToolbar` defaults its own `searchable` prop on.

The direct component is controlled: pass `value` and `onValueChange`. Its
presentation props are `label`, `placeholder`, `collapsedWidth`,
`expandedWidth`, `disabled`, and `className`; `onOpenChange` observes whether
focus or a non-empty value has expanded it. Standard input accessibility and
event props are forwarded. The `searchable` options object intentionally calls
the accessible-name field `ariaLabel`, which DataTable maps to the direct
component's `label` prop.

### Shared Controls Shell

`DataTableControls` is the table-independent responsive shell used by
`DataTableToolbar` and Zero's Data Studio, Storage Studio, global-user,
tenant-member, and platform-workspace toolbars. It owns presentation only; it
does not own TanStack state, server queries, filtering, debounce, or focus.

```tsx
<DataTableControls
  aria-label="Customer directory controls"
  search={<DataTableSearch value={query} onValueChange={setQuery} />}
  controls={<StatusFilter value={status} onChange={setStatus} />}
  actions={<Button onClick={refresh}>Refresh</Button>}
  supplemental={hasFilters ? <ActiveFilters /> : undefined}
/>
```

Its optional `search`, `controls`, `actions`, and `supplemental` props are
`ReactNode` slots. Search always renders first in the wrapping left group,
controls follow it, actions form the responsive right group, and supplemental
content spans the row below. Standard HTML `div` attributes are forwarded.
Use the existing `DataTableToolbar`/`DataTableView` `toolbarSlots` when a slot
needs TanStack context or a render function; specialized Studio/Guardian
components reuse the shell internally but do not thereby gain new public slot
props.

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

All three slots are optional and independent. Use a plain node when the control
does not need table state, and a render function only when it needs the context.
Passing `toolbarSlots={{}}` does not render a toolbar by itself.

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

### Local, Lazy, And Server Controls

For array, collection, and lazy sources, toolbar search and generated filters
operate on the rows already resolved into TanStack. They do not rewrite or
refetch a lazy source. `clearAll` clears global search and column filters.

`filters` on a lazy DataTable and `source.filters` on a
`source={{ type: 'lazy' }}` object are separate `/api/data` inputs that decide
which rows are hydrated. For a custom lazy control, keep that source-filter
state in the parent and update it from `toolbarSlots.controls`.

For `source={{ type: 'server' }}`, the same global search, column-filter,
sorting, and pagination state forms the server query. Changing one reruns the
adapter, resets to page zero where appropriate, clears page-local selection,
and hides stale rows until the current authorization-bound response arrives.
This makes the standard toolbar useful for complete server-side result sets
without a second control API.

### Wrapper Components

`CrudPage`, `MasterDetailView`, and `MasterDetailPage` accept
`tableToolbarSlots` and forward it to their generated DataTable. Set
`tableToolbarLabel` when the default `Table controls` accessible name is not
specific enough. Their `searchable` prop also accepts the same
`boolean | DataTableSearchOptions` contract. `CrudPage.toolbar` remains
page-header content beside its Create action; it is not a table-toolbar slot.
Both wrapper props are optional, so existing wrapper call sites remain valid.

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
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      variant: 'destructive',
      confirm: {
        title: (row) => `Delete ${row.name}?`,
        description: 'This action cannot be undone.',
        holdToConfirm: true,
      },
      onClick: async (row, { signal } = {}) => {
        await deleteContact(row.contact_id, { signal });
      },
    },
  ]}
/>
```

Selection checkboxes and row action cells stop row-click propagation so they can
be used safely inside master-detail layouts.

Row and bulk action definitions support stable `id`, `visible`, `disabled`,
`disabledReason`, `variant`, an optional confirmation/hold-to-confirm contract,
and an awaited `onClick`. The callback receives a
`DataTableMutationContext` with an `AbortSignal` and opaque `operationId`.
Pending actions are deduplicated by their operation key and the signal aborts
when the login, tenant, authorization data, source boundary, or component
lifecycle changes. `refreshOnSuccess` defaults to `true`; set it to `false` when
the mutation already leaves the source current.

`bulkActions` on `DataTableView` always targets the explicit rows selected on
the currently loaded page:

```tsx
<DataTableView
  schema={contactTable.schema}
  source={{ type: 'server', table: 'contacts' }}
  selectable
  bulkActions={[
    {
      id: 'archive',
      label: 'Archive',
      onClick: async (selection, { signal } = {}) => {
        if (selection.scope !== 'page') return;
        await archiveContacts(selection.rowIds, { signal });
      },
    },
  ]}
/>
```

Zero never interprets a selected server page as "all matching." The exported
low-level `DataTableBulkActions` component can receive an explicit
`{ scope: 'all-matching', target, selectionKey, total }` selection only when an
app-owned backend supplies that executable target and stable key.

CSV export follows the same honest boundary: it exports visible columns from
the rows currently resolved into TanStack. For local tables that means all
loaded, filtered rows; for an isolated server source it means the loaded page,
not every server match. Implement a dedicated server export endpoint when the
product needs a complete-result export.

## Inline Editing And Write Ownership

Editable cells remain open while an async write is pending. They close, or move
to the next editable cell on Tab, only after the writer accepts the change. A
failed write keeps the editor and attempted value available with an inline
retry action. Values are encoded through the schema field codec before the
writer runs.

The writer contract is deliberately compatible with existing tables:

- With `collection` or another source exposing `actions.update`, DataTable
  performs and awaits the source write. Existing `onCellEdit` then runs as a
  post-write notification.
- With caller-owned `data` and no source update action, `onCellEdit` remains the
  authoritative writer, exactly as before.
- `onCellCommit` is the explicit custom-writer override. When present it is the
  only writer: DataTable does not auto-update the source and does not also call
  `onCellEdit`.

Use `onCellCommit` for a custom endpoint or command bus:

```tsx
<DataTableView
  schema={invoiceTable.schema}
  source={{ type: 'server', table: 'invoices' }}
  editable={['status', 'memo']}
  onCellCommit={async (rowId, columnId, encodedValue, context) => {
    await client.fetch(`/api/invoices/${rowId}`, {
      method: 'PATCH',
      signal: context?.signal,
      body: JSON.stringify({ [columnId]: encodedValue }),
    });
  }}
/>
```

For collection sources, the built-in writer waits for the exact Sync
acknowledgment. A caller abort or wait timeout stops waiting but does not imply
that an already-submitted optimistic mutation was rolled back; see
[SDK mutations](../sdk-reference.md#acknowledged-optimistic-mutations).

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

Lazy, server, and custom data sources can surface loading and error states.
Full-sync collections usually render immediately from the client store. An
initial or changed server query renders `loadingState`; a same-query refresh may
keep the accepted page visible and adds an "Updating records…" status. The
default error state uses safe framework text and a retry action; `errorState`
can replace its presentation without changing request fencing.

Server requests are abortable, ordered, and partitioned by the live
authorization boundary. A late response from a prior search, tenant, login, or
adapter cannot display after that boundary changes.

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

Use `state` to control only the facets the parent actually owns. Remaining
facets stay internal, while `onStateChange` receives the complete next state:

```tsx
const [sorting, setSorting] = useState<SortingState>([
  { id: 'created_at', desc: true },
]);

<DataTableView
  schema={orderTable.schema}
  source={{ type: 'server', table: 'orders' }}
  state={{ sorting }}
  onStateChange={(next) => setSorting(next.sorting)}
/>
```

`DataTableState` contains `globalFilter`, `columnFilters`, `sorting`,
`pagination`, `rowSelection`, and `columnVisibility`. Search, filters, sorting,
page-size changes, and source/authorization-boundary changes reset the page to
zero and clear page-local selection. Ordinary page navigation also clears the
old page's selection. A controlled facet remains controlled, so its parent must
adopt the corresponding value from `onStateChange`.

For deeper control, compose the exported subcomponents, `useDataTable()`,
`useDataTableSource()`, and `useDataTableMutationRunner()` directly.

## Upgrade Notes

The server-source, async-action, state-control, and sizing work is additive.
Existing `DataTable`/`DataTableView` call sites do not need a schema migration or
page rewrite:

- `data`, `collection`, `lazy`, `filters`, and `lazyOptions` keep their existing
  behavior; an explicit `source` still takes precedence.
- The `DataTable` alias remains supported. `DataTableView` is the preferred name
  for new code.
- Existing synchronous row actions and source actions remain valid because
  `void | Promise<void>` is accepted.
- Existing collection `onCellEdit` callbacks remain post-auto-write
  notifications. Use the new `onCellCommit` only when intentionally replacing
  that built-in writer.
- Array-backed `onCellEdit` remains the writer because no source mutation action
  exists.
- `state`, server sources, bulk actions, confirmation policy, `getRowId`, and
  the new column sizing flags are optional.
- Selection and CSV behavior did not gain an implicit cross-page mode. Server
  pages stay explicit and bounded.

Apps that copied the component with `zero add components/data-table` own that
local source and must review/port the new implementation themselves. A normal
framework package update does not overwrite local component copies.

## Public Exports

```ts
import {
  buildDataTableServerQuery,
  createDataTableApiAdapter,
  DataTableView,
  DataTable,
  DataTableBulkActions,
  DataTableControls,
  DataTableServerSourceError,
  DataTableSearch,
  DataTableToolbar,
  DataTablePagination,
  DataTableRowActions,
  DataTableColumnHeader,
  useDataTable,
  useDataTableMutationRunner,
  useDataTableSource,
  buildDataTableLazyQuery,
} from '@zero/framework/react';
```

Important types:

```ts
import type {
  DataTableProps,
  DataTableState,
  DataTableSource,
  DataTableSourceActions,
  DataTableSourceState,
  DataTableColumnOverride,
  DataTableColumnOverrides,
  DataTableInitialState,
  DataTableFilters,
  DataTableServerAdapter,
  DataTableServerQuery,
  DataTableServerResult,
  DataTableServerPage,
  DataTableServerSource,
  DataTableBulkAction,
  DataTablePageBulkSelection,
  DataTableAllMatchingBulkSelection,
  DataTableMutationContext,
  DataTableMutationRunner,
  DataTableControlsProps,
  DataTableSearchOptions,
  DataTableSearchProps,
  DataTableToolbarContext,
  DataTableToolbarProps,
  DataTableToolbarSlot,
  DataTableToolbarSlots,
  RowAction,
} from '@zero/framework/react';
```

The same table-focused values and types are available from
`@zero/framework/components/data-table`. The package root
`@zero/framework` shares the frontend export surface with
`@zero/framework/react`.
