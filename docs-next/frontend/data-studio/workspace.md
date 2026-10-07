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
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
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

const controller = useDataStudio({ rowLoading: 'progressive', pageSize: 25 });
<DataStudioWorkspace controller={controller} capabilities={{ canManage: false }} />;
```

The hook fragment belongs inside React. Narrowing manage permission hides
management UI without changing server authority.

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
