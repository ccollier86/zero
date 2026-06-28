# MasterDetailView

`MasterDetailView` is Zero's reusable list/detail organism. It combines a
schema-aware `DataTableView`, responsive list/detail layout, a sticky detail
panel, generated edit forms, record navigation, and custom action slots.

`MasterDetailPage` remains as a backwards-compatible alias. New app code should
prefer `MasterDetailView`.

## Fast Path

```tsx
import { MasterDetailView } from '@platform/frontend';
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
  schema={userTable.schema}
  collection="users"
  listColumns={['name', 'email', 'role']}
/>
```

Use this for the common case where records should be live and editable in the
browser.

### Caller-Owned Or Lazy Data

`MasterDetailView` intentionally keeps lazy reads outside the organism. Use
`useLazyCollection()`, custom SDK calls, or another data source, then pass
`data` and `onUpdate`.

```tsx
const users = useLazyCollection<UserRow>('users', {
  status: 'active',
}, {
  order: 'created_at',
  dir: 'desc',
  limit: 100,
});

<MasterDetailView
  schema={userTable.schema}
  data={users.data}
  listColumns={['name', 'email', 'role']}
  onUpdate={(id, changes) => users.update(id, changes)}
/>
```

This keeps the list/detail component focused on UI composition while the caller
owns larger query policy, filters, paging, and retry behavior.

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

`editableFields` hides fields from the generated form and filters submitted
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
  className="h-[42rem]"
/>
```

Desktop uses a side-by-side grid. Mobile shows the list first, then slides the
detail panel into view after selection. The bottom navigation bar remains below
the main content.

## Low-Level Detail Primitives

Use the primitives directly when a screen needs a custom list or detail source
but should keep Zero's polished list/detail shell.

```tsx
import {
  DetailPanel,
  ListDetailLayout,
  RecordNavigationBar,
} from '@platform/frontend';

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
| `ListDetailLayout` | Responsive list/detail shell and panel transition |
| `DetailPanel` | Sticky header, scrollable detail body, sticky footer, empty state |
| `RecordNavigationBar` | Previous/next controls, record actions, primary action |

## Public Exports

```ts
import {
  MasterDetailView,
  MasterDetailPage,
  DetailPanel,
  ListDetailLayout,
  RecordNavigationBar,
} from '@platform/frontend';
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
} from '@platform/frontend';
```
