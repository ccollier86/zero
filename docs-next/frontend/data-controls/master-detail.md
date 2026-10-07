---
id: zero.frontend.data-controls.master-detail
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: verified
visibility: internal
system: frontend-data-controls
feature: master-detail
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# One List, Detail Panel And Action Bar

[Data controls index](./index.md) · [Documentation index](../../index.md)

MasterDetailPage and alias MasterDetailView combine a schema-aware table, selected
record, detail form/content and bottom record navigation/action bar. Use this
organism when a screen needs compact list management plus rich selected-record
controls. The same layout can support user, drive or app record control planes;
domain-specific server services remain separate.

## Minimal Fragment

```tsx
import { MasterDetailPage } from '@zero/framework/components/master-detail';

<MasterDetailPage
  schema={tasks.schema}
  listColumns={['title', 'done']}
  collection="tasks"
  editableFields={['title', 'done']}
/>;
```

This fragment assumes a configured client/provider and admitted tasks collection.
Explicit source wins legacy collection/data; collection wins data.
Supported sources match [DataTable sources](./data-table/sources.md), including
server queries. Source schema/permissions own access; the component does not
provision a database or alter Guardian configuration.

## Props And Defaults

schema/listColumns are required. primaryKey overrides the schema key.
editableFields limits generated detail fields; omission selects all schema fields.
source/data/collection/lazy/filters/lazyOptions have the shared source semantics.

selectedId controls selection (null forces none); defaultSelectedId initializes
uncontrolled selection. autoSelectFirst defaults true for uncontrolled usage.
onSelectedIdChange receives (id, item), and onSelect receives the selected row.
Selection uses the accepted source membership and stable string/numeric identity;
it resets across source/authorization partitions.

searchable defaults true, sortable true, paginated true for server sources and
false otherwise. tableToolbarSlots/tableToolbarLabel compose the shared search-first
controls. formColumns defaults 2, submitLabel "Save Changes". listWidth/detailWidth
default through the layout to '3fr'/'2fr'. className decorates the outer organism.
detailVisible defaults true for desktop; resizable defaults false and enables
the established library separator. Hiding desktop detail leaves mobile
selected-record inspection available. These controls are supported in Zero 2.6.0.
loadingState/errorState customize first-load presentation. Server controls stay
mounted while loading; rows/pages are not filtered or fetched through a second
browser-array pass.

The list uses DataTable's shared pagination controller: changing Rows per page
keeps the page containing the former first row for local/offset data. Cursor
batch-size changes start a fresh history. This is distinct from the bottom
bar's previous/next **record** selection; that bar is not a second page-query
engine. See [table state](./data-table/state-and-columns.md#state-and-pagination-resets)
for the anchor formula, selection retirement and known-total clamping.

detailHeader is a component receiving { item }. emptyState/emptyStateText customize
the unselected panel. renderDetail(item, context) replaces AutoForm; detailContent
adds sections below the body. detailFooter is ReactNode or (item|null, context)
rendering sticky detail footer content.

## Bounded Workspace And Mobile Inspection

Place the organism inside [AppShell workspace mode](../app-shell/configuration.md)
or another bounded-height flex/grid region. A page wrapper between the shell and
organism should preserve `flex min-h-0 min-w-0 flex-1 flex-col`; do not insert an
unconstrained height-growing wrapper. The list, detail motion region and
DetailPanel body each keep the zero-minimum height chain. Long lists and forms
scroll inside their own panes while the bottom actions remain in the workspace.

On desktop both panes appear by default. Use detailVisible=false for a
mostly-grid screen, then expose an explicit Inspect control that opens desktop
details. resizable delegates to [Resizable panels](../components/primitives/resizable.md);
initial CSS track widths apply until a user resize, and that relative sizing is
retained across hide/show and responsive transitions while mounted. The bounded
desktop minimums are 12rem for the list and 16rem for detail.

On mobile selecting a record opens its detail, including an accessible Back to
list button. Back preserves the selected key; it changes only which pane is
shown. One mounted list/detail tree avoids duplicated IDs, effects or form
state. A newly selected record still follows the intentional detail crossfade.
At narrow widths the bottom operational actions scroll in their own strip and
primary actions stay reachable rather than expanding the page sideways.

```tsx
import { AppShell } from '@zero/framework/components/app-shell';
import { MasterDetailPage } from '@zero/framework/components/master-detail';
import { defineSchema, field } from '@zero/framework/schema';

const schema = defineSchema({ title: field.text({ label: 'Title' }) });
const rows = [{ id: 'example', title: 'Example record' }];

export function LocalRecordWorkspace() {
  return <AppShell sidebar={false} contentMode="workspace" header={{ title: 'Records' }}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MasterDetailPage schema={schema} listColumns={['title']} data={rows}
        resizable listWidth="minmax(0, 1fr)" detailWidth="minmax(18rem, 22rem)"
        renderDetail={item => <p>{item.title}</p>} />
    </div>
  </AppShell>;
}
```

This is a read-only local-data composition. An editable app must supply an
accepted writer or an authorized live source as described below.

## Place Controls Where They Belong

Use the right detail panel for roles, membership/property fields, summaries and
selected-record information. Use navigationActions(selectedItem|null) for compact
record commands in the bottom bar, and primaryAction for the main workflow.
Do not turn routine commands into disconnected oversized cards.

NavigationAction contains icon, label, onClick, optional variant
(default/destructive/success/warning) and disabled. RecordPrimaryAction contains
label/onClick and optional sublabel/shortcut/disabled/ariaHasPopup.
Those button callbacks are caller-owned; they do not automatically acquire the
table's async operation runner. Compose a runner when tracking app operations,
and retain server permission/confirmation checks.

## Detail Context And Accepted Writes

MasterDetailRenderContext exposes primaryKey, selectedId/selectedItem,
selectedIndex/totalCount, previous/next availability, selectId/selectItem/
selectPrevious/selectNext, update, liveActions, sourceType, isLoading, error and
refresh. totalCount is the accepted source row count for record navigation, not an
invented serverwide matching total.

context.update(changes) uses onUpdate(id, changes) when supplied, otherwise
the live source update. Generated AutoForm follows the same path and awaits
acceptance; onUpdateError receives safe form error text. No writer rejects
DATA_TABLE_MUTATION_ACTION_UNAVAILABLE instead of silently succeeding.
A retained/mid-flight replaced source rejects DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE.
Late completion cannot finish a replacement scope's form. When no selected item
exists context.update returns without initiating a write; disable custom actions
accordingly.

The app-owned onUpdate must return/await its accepted writer. Primary keys and
read-only projected identities are not editable authority. Mobile list/detail
navigation preserves the selected key while exposing a return-to-list action.

## Verification And Compatibility

Exercise arrays with custom onUpdate, full/lazy collections, server search/sort/
unknown totals/cursors, numeric identities, failed writes and a scope change while
a write is pending. Shared controller and acceptance tests cover those Zero 2.6
paths. They do not replace deployment checks or qualification of an application's
custom action lifecycle.

## Related Guides And Next Steps

- [DataTable](./data-table/index.md) owns shared queries, control slots and sizing.
- [Forms](../forms/index.md) owns generated field state/validation.
- [CRUD](./crud-page.md) adds ready-made create/edit/delete workflows.
- [Guardian control planes](../guardian/index.md) specializes the layout for access.
