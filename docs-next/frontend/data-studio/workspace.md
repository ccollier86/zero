---
id: zero.frontend.data-studio.workspace
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: workspace
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7ee11611534e6b88ed4041d561c102c8299591ec"
  snapshot: dirty
  date: "2026-10-13"
  evidence_level: source-observed
---

# Connected Workspace And Action Placement

[Data Studio index](./index.md) · [Documentation index](../../index.md)

```tsx
import { DataStudio } from '@zero/framework/react';

<DataStudio title="Tables" description="Records for this organization's workflows." />;
```

Place this fragment under the normal AppProvider in an admitted organization.
DataStudio creates useDataStudio and passes its result to DataStudioWorkspace.
Use the workspace directly when a custom parent owns the same controller:

```tsx
import { useDataStudio } from '@zero/framework/react';
import { DataStudioWorkspace } from '@zero/framework/components/data-studio';

const controller = useDataStudio({ rowLoading: 'progressive', autoSelectFirstTable: false, pageSize: 25 });
<DataStudioWorkspace controller={controller} capabilities={{ canManage: false }} />;
```

The hook fragment belongs inside React. Narrowing manage permission hides
management UI without changing server authority.

## Table Catalog And Empty Start

The connected workspace starts with a table catalog rather than opening the first
table automatically. Each keyboard-accessible card uses shared `Card` tokens and
shows the table name, stable key, description, lifecycle and the controller's live
record count. Search matches these catalog summaries locally; it is separate from
the server-backed **record** search. Active/archived/all filters still belong to
the scoped controller. Loading and failures are never presented as an empty catalog.

With no tables in the selected filter, a compact empty state explains what comes
next. Managers can create their first table; read-only users see an administrator
hint, not a nonfunctional create action. View all tables distinguishes an empty
active/archived filter from an entirely empty catalog. Both create entry points
open the same managed schema form. Picking a card opens the existing grid; its
dropdown remains available for quick switching, while **All tables** returns to
the catalog. `initialTableId` supports direct entry; `autoSelectFirstTable: true`
opts back into the former initial auto-selection. See [configuration](./configuration.md).

Workspace composes the shared search-first toolbar, schema-header grid, optional
inspector and ListDetailLayout. The connected DataStudio defaults to progressive
loading: bounded server batches append as the grid scrolls; there are no page
buttons beneath this editor. The general useDataStudio hook remains paged by
default for existing custom screens. Set `rowLoading: 'progressive'` when composing
this workspace with that hook. Search, filters and sort remain server-backed.

The grid keeps schema headers for zero records, supports column resizing and
horizontal scrolling within its own viewport. Click a header to edit a column,
or use its visible options button/right-click menu. Add column is both in the
header's last cell and in the anchored action bar, so a wide schema does not hide
the only entry point. A display rename/reorder preserves stable column IDs/keys;
an explicit API-key change requires acknowledgement. See [grid](./grid.md).

The inspector is hidden on desktop by default (`defaultDetailsOpen: false`),
leaving the grid the available width. `detailsOpen`/`onDetailsOpenChange` allow
controlled visibility; `resizableDetails` defaults true. Show details opens compact
table metadata or full selected-record values, not a wall of schema cards.
The bar groups inspect, add/edit column, archive/restore, add record and delete
record according to live capability, selection, pending state and lifecycle.
Previous/Next **record** actions traverse loaded records; they are not page
requests. No selection hides an unhelpful `0 / 0` navigation counter.

Bottom-bar operational actions are icon-only at rest, expanding their full label
on hover or keyboard focus while retaining complete accessible names. Touch
reveals on the first tap and invokes on the second; a changed table/record/scope
retires that touch intent. Enter/Space and mouse activation remain single-step,
and reduced motion reveals immediately. Add record keeps its visible primary
label. At narrow widths the action strip has its own horizontally scrolling row,
so labels remain readable and the bar does not widen the page. Custom
RecordNavigationBar compositions can set `actionLabelMode="visible"`, or set
`labelMode: 'visible'` on an individual NavigationAction; see
[shared master/detail controls](../data-controls/master-detail.md).

## Bounded Composition

Use AppShell's workspace content mode, or an equivalent constrained height chain:

```tsx
import { AppShell } from '@zero/framework/components/app-shell';
import { DataStudio } from '@zero/framework/react';

<AppShell contentMode="workspace" sidebar={false}>
  <DataStudio className="min-h-0 flex-1" />
</AppShell>;
```

The workspace root and both panes use min-height/width zero within a bounded
flex track; the action bar is a non-scrolling sibling. Long records scroll inside
the inspector, wide schemas inside the grid, and neither widens/stretches the
page. Custom page wrappers must keep `min-h-0 min-w-0 flex-1` between the shell
and workspace. See [shared layout](../components/primitives/list-detail.md).

Non-ready states distinguish idle/loading/disabled/denied/error and can present
emptyState. During loading/mutation aria-busy reflects the controller. Archived
tables remain a lifecycle selection, not editable active records. On mobile a
read-only row inspection opens the detail panel with return-to-records navigation.
Editable-cell selection stays in the mobile grid so the focused input remains
usable; Inspect record explicitly opens the selected record's full details.

create/edit table, create row, delete and status operations use focused dialogs.
Those dialogs await controller promises, keep opening revisions and captured
record/status targets, and retire on organization/table replacement. Read/mutation errors remain visible
with explicit reload feedback; supplied error text is not automatic redaction of
all app failures. Server authority still fences every operation.

The workspace captures each actual clicked button for modal-origin motion and
focus return. The shared manager owns header/footer/X, blur/recede, stack and portal
ordering; feature dialogs do not replace that anatomy. Programmatic opens without
a trigger use Rise. A standalone controlled dialog inherits the existing host or
uses the manager's single-scene fallback. See [dialogs](./dialogs.md).

## Verification

Use distinct read/write/manage identities, empty/no-selected states, active/
archived tables, narrow screens, a delayed/rejected write and organization change.
Check actions are grouped with the selected context and old scope records clear.
Synthetic real-browser regressions use compiled Zero styles and check wide,
narrow, light/dark composition, full inspector values, captured confirmations,
scope retirement and stable widths. They do not claim an installed archive or
Pantheon deployment has already been updated.

## Related Guides And Next Steps

- [Controller](./controller.md) owns data and mutations.
- [Toolbar](./toolbar.md) owns query controls.
- [Inspector](./inspector.md) owns selected-record information.
- [Dialogs](./dialogs.md) owns accepted interactive workflows.
