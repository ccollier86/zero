# MasterDetailView

[Frontend index](./README.md) · [AppShell](./app-shell.md) · [Data Studio](../data-studio.md)

`MasterDetailView` is Zero's reusable list/detail organism. It combines a
schema-aware `DataTableView`, responsive list/detail layout, a sticky detail
panel, generated edit forms, record navigation, and custom action slots.

`MasterDetailPage` remains as a backwards-compatible alias. New app code should
prefer `MasterDetailView`.

## Fast Path

```tsx
import { MasterDetailView } from '@zero/framework/react';
import { clientTable } from '@app/lib/schema';

export function ClientsPanel() {
  return (
    <MasterDetailView
      schema={clientTable.schema}
      collection="clients"
      listColumns={['name', 'email', 'status']}
      editableFields={['name', 'email', 'status', 'notes']}
      searchable
      paginated={{ pageSize: 25 }}
    />
  );
}
```

When `collection` is provided, the list subscribes through the frontend SDK
collection store and generated detail-form updates write back through that
collection unless `onUpdate` is supplied.

## Data Sources

### Full-Sync Collection

```tsx
<MasterDetailView
  schema={contactTable.schema}
  collection="contacts"
  listColumns={['name', 'email', 'role']}
/>
```

Use this for the common case where records should be live and editable in the
browser. This example is an app-owned `contacts` table, not Zero's private auth
`users` table. Use the auth admin SDK/UI for account management.

### Lazy `/api/data` Source

`MasterDetailView` accepts the same `source` contract as `DataTableView`, so
large tables can start with a bounded `/api/data` read and stay live for loaded
rows.

```tsx
<MasterDetailView
  schema={contactTable.schema}
  source={{
    type: 'lazy',
    table: 'contacts',
    filters: { status: 'active' },
    options: {
      order: 'created_at',
      dir: 'desc',
      limit: 100,
    },
  }}
  listColumns={['name', 'email', 'status']}
  editableFields={['name', 'status']}
/>
```

Use this for admin explorers, large operational tables, and views where
full-syncing the whole table would be wasteful. The generated detail form still
writes through the loaded collection unless `onUpdate` is supplied.

### Caller-Owned Data

Use `source={{ type: 'data' }}` or `data` when another hook, SDK call, or
external backend owns loading and writes.

```tsx
<MasterDetailView
  schema={userTable.schema}
  source={{
    type: 'data',
    data: users.data,
    actions: {
      update: users.update,
    },
    isLoading: users.isLoading,
    error: users.error,
    refresh: users.refresh,
  }}
  listColumns={['name', 'email', 'role']}
/>
```

## Selection

Uncontrolled selection auto-selects the first available row by default. Use
`defaultSelectedId` for the initial row, or `autoSelectFirst={false}` when the
view should start empty.

```tsx
<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['name', 'status']}
  defaultSelectedId={initialClientId}
  autoSelectFirst={false}
/>
```

Use controlled selection when the route or surrounding dashboard owns the
selected record.

```tsx
<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['name', 'status']}
  selectedId={selectedClientId}
  onSelectedIdChange={(id, item) => {
    setSelectedClientId(id);
    setSelectedClientName(item?.name ?? null);
  }}
/>
```

Selection uses `schema.primaryKey` by default. The `primaryKey` prop can
override this when the view needs a different stable identifier.

## Generated Detail Form

By default, the detail panel renders an `AutoForm` in edit mode.

```tsx
<MasterDetailView
  schema={projectTable.schema}
  collection="projects"
  listColumns={['name', 'status', 'owner']}
  editableFields={['name', 'status', 'owner', 'summary']}
  formColumns={2}
  submitLabel="Save Project"
/>
```

`editableFields` excludes fields from generated rendering and validation and filters submitted
changes down to only those fields.

If `onUpdate` is omitted and `collection` is present, form submissions call the
collection's `update(id, changes)` action. If `onUpdate` is provided, that
callback owns the write.

```tsx
<MasterDetailView
  schema={projectTable.schema}
  collection="projects"
  listColumns={['name', 'status']}
  onUpdate={async (id, changes) => {
    await saveProject(id, changes);
  }}
  onUpdateError={(message) => toast.error(message)}
/>
```

## Custom Detail Body

Use `renderDetail` when the right panel should be a custom read model or a more
specialized editor instead of the generated form.

```tsx
<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['name', 'status']}
  renderDetail={(client, ctx) => (
    <ClientOverview
      client={client}
      canSelectNext={ctx.canSelectNext}
      onArchive={() => ctx.update({ status: 'archived' })}
      onOpenNext={ctx.selectNext}
    />
  )}
/>
```

The render context is designed to prevent detail children from needing to know
how selection or collection wiring is implemented.

```ts
interface MasterDetailRenderContext<T> {
  primaryKey: string;
  selectedId: string | null;
  selectedItem: T | null;
  selectedIndex: number;
  totalCount: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectId(id: string | null): void;
  selectItem(item: T): void;
  selectPrevious(): void;
  selectNext(): void;
  update(changes: Partial<T>): void | Promise<void>;
  liveActions: MasterDetailLiveActions<T> | null;
}
```

Use `detailContent` when the generated form is still useful but a selected
record needs extra content below it.

```tsx
<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['name', 'status']}
  detailContent={(client, ctx) => (
    <ClientNotes clientId={String(client[ctx.primaryKey])} />
  )}
/>
```

## Headers, Footers, And Actions

```tsx
<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['name', 'email', 'status']}
  detailHeader={({ item }) => <ClientDetailHeader client={item} />}
  detailFooter={(item, ctx) => item && (
    <ClientDetailFooter client={item} onSaveDraft={() => ctx.update({ status: 'draft' })} />
  )}
  navigationActions={(client) => client ? [
    { label: 'Email', icon: <Mail size={16} />, onClick: () => emailClient(client) },
    { label: 'Archive', icon: <Archive size={16} />, variant: 'warning', onClick: () => archiveClient(client) },
  ] : []}
  primaryAction={{
    label: 'New Client',
    shortcut: 'N',
    onClick: openCreateClient,
  }}
/>
```

`detailHeader` receives the selected item and renders above the detail body.
`detailFooter` can be static content or a function of the selected item and
render context. `navigationActions` are rendered in the bottom
`RecordNavigationBar`, next to previous/next controls.

## Empty State

```tsx
<MasterDetailView
  schema={ticketTable.schema}
  collection="tickets"
  listColumns={['subject', 'status']}
  autoSelectFirst={false}
  emptyState={<TicketEmptyState />}
/>
```

If no custom empty state is supplied, the lower-level `DetailPanel` shows
"Select a record to view details".

## Layout

```tsx
<MasterDetailView
  schema={orderTable.schema}
  collection="orders"
  listColumns={['number', 'customer', 'status']}
  listWidth="2fr"
  detailWidth="3fr"
  detailVisible={detailsOpen}
  resizable
  className="h-[42rem]"
/>
```

Desktop places the panes side by side with independent scrolling. `listWidth`
and `detailWidth` retain their CSS-track defaults (`3fr` and `2fr`).
`detailVisible={false}` hides the desktop pane and returns that space to the
list; it does not prevent selected-record inspection on mobile. `resizable`
defaults to false and enables a pointer/keyboard separator on desktop when both
panes are visible. Resizing delegates to the packaged resizable-panel library;
the normal selection/form tree is not duplicated across responsive modes.

On mobile, selection opens details, and **Back to list** returns to the list
while retaining selection and restoring focus where possible. The bottom
action bar is a non-scrolling sibling of the panes. Long records do not stretch
the whole page or push actions beneath the details.

## Bounded Workspace Composition

Independent pane scrolling needs a bounded height chain, not only
`overflow-auto` on a child. [AppShell](./app-shell.md#content-height-and-scrolling)
supplies it in workspace mode. Keep intermediate wrappers shrinkable:

```tsx
import { AppShell, MasterDetailView } from '@zero/framework/react';

<AppShell contentMode="workspace">
  <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <header className="shrink-0">Clients</header>
    <MasterDetailView
      schema={clientTable.schema}
      collection="clients"
      listColumns={['name', 'email', 'status']}
      resizable
    />
  </section>
</AppShell>
```

The shell bounds the content; the workspace and animated detail wrapper retain
`min-h-0`/`min-w-0`; the list and detail children own their scroll regions; the
bottom bar stays outside those regions. In document mode, give the workspace a
deliberate height such as the `h-[42rem]` example above. Avoid a new `min-height`
or auto-height wrapper that forces the workspace to grow with its records.

## Low-Level Detail Primitives

Use the primitives directly when a screen needs a custom list or detail source
but should keep Zero's polished list/detail shell.

```tsx
import {
  DetailPanel,
  ListDetailLayout,
  RecordNavigationBar,
} from '@zero/framework/react';

<ListDetailLayout
  hasSelection={selectedItem != null}
  selectedKey={selectedId ?? undefined}
  list={<CustomList items={items} onSelect={setSelectedId} />}
  detail={
    <DetailPanel
      isEmpty={selectedItem == null}
      header={selectedItem && <Header item={selectedItem} />}
      footer={selectedItem && <Footer item={selectedItem} />}
    >
      {selectedItem && <CustomDetails item={selectedItem} />}
    </DetailPanel>
  }
  bottomBar={
    <RecordNavigationBar
      currentIndex={selectedIndex}
      totalCount={items.length}
      onPrevious={selectPrevious}
      onNext={selectNext}
    />
  }
/>
```

Primitive responsibilities:

| Primitive | Responsibility |
| --- | --- |
| `ListDetailLayout` | Bounded independent panes, responsive detail transition, optional desktop resizing and anchored bottom bar |
| `DetailPanel` | Non-scrolling header/footer, bounded scrollable body and empty state |
| `RecordNavigationBar` | Loaded-record navigation, optional status, record actions and primary action |

`ListDetailLayout` accepts `detailVisible` (desktop, default true) and
`resizable` (default false). Mobile visibility defaults to `hasSelection`; use
`mobileDetailOpen` with `onMobileBack` when inspection must be separate from
selection, as in a spreadsheet editor. `mobileBackLabel` changes the visible
return label. When controlling mobile visibility, supply the return callback
so the Back action can close it.

`RecordNavigationBar.showNavigation={false}` hides the record counter and
Previous/Next without hiding actions. `status` supplies a separate accessible
scope/count message. `secondaryPrimaryAction` adds an adjacent primary workflow.
These are record/action controls, not a data-source pagination mechanism. At
narrow widths, actions remain reachable in their horizontal strip and primary
workflows reflow beneath it.

## Public Exports

```ts
import {
  MasterDetailView,
  MasterDetailPage,
  DetailPanel,
  ListDetailLayout,
  RecordNavigationBar,
} from '@zero/framework/react';
```

Important types:

```ts
import type {
  MasterDetailPageProps,
  MasterDetailRenderContext,
  DetailPanelProps,
  ListDetailLayoutProps,
  RecordNavigationBarProps,
  NavigationAction,
} from '@zero/framework/react';
```
