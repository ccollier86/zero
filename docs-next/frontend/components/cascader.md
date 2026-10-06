---
id: zero.frontend.components.cascader
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: cascader
maturity: supported
applies_to: ["Unreleased Cascader source on top of Zero 2.2.1; not in the published 2.2.1 archive"]
modes: [browser, SSR, single-selection, multi-selection, static, async]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "ea971213e7bc7f3b1d11b16cda42227ca8287a60"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: contract-tested
---

# Cascader

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

`Cascader` is Zero's reusable hierarchical picker. Browse one level at a time,
search across the known tree, select one leaf or a capped set of leaves, and
keep commands reachable beneath the scrolling list. Optional asynchronous
loaders supply children and search results without changing the control's
presentation. Full-path values and chips distinguish repeated labels.

This is a general selection component, not a permissions editor or a source
of Guardian authority. Applications supply their choices and own persistence.
It composes Zero's existing Command, Popover, Checkbox, Badge, Button and
DropdownMenu controls and uses the same light/dark design tokens.

## Imports And Tree Data

Import the component family and its types from
`@zero/framework/components/cascader`. The same family is available through
`@zero/framework/react` and the framework root.

Each `CascaderNode<T>` has a globally unique string `value` and readable string
`label`. Optional fields are `description`, `icon`, `keywords`, `disabled`,
`children`, `hasChildren` and application-owned `data: T`. Labels may repeat;
values must not. For example, `customers.name` and `orders.name` can both have
the label **Name** without becoming the same selection.

Branches navigate; leaves select. There is no implied “select every descendant”
grant. A disabled branch also disables selection through that branch. Duplicate
values, cycles and malformed node data are rejected instead of silently picking
one of the ambiguous entries. Keep stable values when changing display labels.

## Combined Picker With A Selection Cap And Footer

This complete local-state example combines nested navigation, checkboxes,
deep local search, a pinned footer, a side import menu and external chips.
`importPermissions` is an application-supplied operation; the example does not
perform a Guardian role assignment.

```tsx
'use client';

import * as React from 'react';
import {
  Cascader, CascaderAction, CascaderBreadcrumb, CascaderContent,
  CascaderFooter, CascaderImportMenu, CascaderInput, CascaderItems,
  CascaderList, CascaderPanel, CascaderSelectionChips, CascaderTrigger,
  CascaderValue, useCascaderSelection, type CascaderNode,
} from '@zero/framework/components/cascader';
import { Upload } from '@zero/framework/icons';

const permissions: readonly CascaderNode[] = [
  { value: 'documents', label: 'Documents', children: [
    { value: 'documents:read', label: 'Read', description: 'View documents' },
    { value: 'documents:edit', label: 'Edit', description: 'Change documents' },
  ] },
  { value: 'reports', label: 'Reports', children: [
    { value: 'reports:read', label: 'Read', description: 'View reports' },
    { value: 'reports:export', label: 'Export', keywords: ['download'] },
  ] },
];

function ClearSelection() {
  const selection = useCascaderSelection();
  return <CascaderAction onSelect={selection.clear}
    disabled={selection.disabled || selection.values.length === 0}>
    Clear
  </CascaderAction>;
}

export function PermissionChoices({ importPermissions }: {
  importPermissions: () => void | Promise<void>;
}) {
  const [selected, setSelected] = React.useState<readonly string[]>([]);
  return <Cascader items={permissions} multiple max={3}
    value={selected} onValueChange={setSelected} label="Permission choices">
    <CascaderTrigger><CascaderValue placeholder="Choose permissions…" /></CascaderTrigger>
    <CascaderContent>
      <CascaderPanel>
        <CascaderInput placeholder="Search all permissions…" />
        <CascaderBreadcrumb rootLabel="All permissions" />
        <CascaderList><CascaderItems /></CascaderList>
        <CascaderFooter>
          <ClearSelection />
          <CascaderImportMenu actions={[{
            id: 'file', label: 'Import from a file', icon: <Upload />,
            onSelect: importPermissions,
          }]} />
        </CascaderFooter>
      </CascaderPanel>
    </CascaderContent>
    <CascaderSelectionChips className="mt-3" emptyLabel="No permissions selected." />
  </Cascader>;
}
```

Place `CascaderFooter` outside `CascaderList`, as a sibling within the panel.
The list owns bounded scrolling, so filtering or changing levels does not hide
footer commands. `CascaderImportMenu` opens beside its trigger on desktop, and
below it at widths under 768px so the menu remains reachable on small screens.
The existing Zero dropdown handles viewport collisions. The menu does not parse
a file, provision storage or invent an import API.

Selected leaves remain removable after reaching the cap. The cap prevents new
interactive additions; it does not retroactively truncate controlled selections
or validate a persisted permission grant. Enforce business limits on the server.

For a single value, omit `multiple` and use `value: string | null` or
`defaultValue: string | null`. Multiple mode uses a readonly string array.
Without `value`, `defaultValue` seeds local state. With `value`, the parent
must accept `onValueChange` and supply the next value; the component does not
override its owner.

## Asynchronous Drill-Down And Complete Search

Set `hasChildren: true` for an unloaded branch. `getChildren(node, { signal })`
returns that branch's child array; `node` is `null` when loading the root.
Supply stable loader callbacks. Use Zero's normal authenticated SDK transport
inside the callbacks and pass the AbortSignal to the supported request option;
do not attach manually cached bearer headers.

Child loading happens before navigation. An unsuccessful load leaves the
current level visible; Retry repeats the failed branch rather than loading an
unrelated root. A successful empty child list leaves you on the parent level
and makes that node selectable as a leaf. Successfully loaded children join
the known tree and its path-aware selection/search metadata. When a remote
search result points into unloaded ancestors, the controller admits each
ancestor level before entering the result's branch. A missing, moved or
disabled trail cannot move the picker to a fabricated level.

Local search scans every known level, including ancestors' labels and keywords,
not only the visible list. Matching results carry their full path. It cannot
discover descendants that the server has not supplied. Add
`onSearch(query, { signal })` when searching an incompletely loaded tree. Each
returned `CascaderSearchResult<T>` must contain both `node` and its complete
root-to-result `path` of nodes, including the result itself. The endpoint must
only return choices the current user/organization is allowed to discover.

```tsx
'use client';

import * as React from 'react';
import {
  Cascader, CascaderBreadcrumb, CascaderContent, CascaderInput,
  CascaderItems, CascaderList, CascaderPanel, CascaderSelectionChips,
  CascaderTrigger, CascaderValue, type CascaderNode,
  type CascaderChildrenLoader, type CascaderSearchLoader,
} from '@zero/framework/components/cascader';

const initialItems: readonly CascaderNode[] = [];

type AttributePickerProps = {
  scopeKey: string;
  loadLevel: CascaderChildrenLoader;
  searchAll: CascaderSearchLoader;
};

export function OrganizationAttributes(props: AttributePickerProps) {
  return <AttributePicker key={props.scopeKey} {...props} />;
}

function AttributePicker({ scopeKey, loadLevel, searchAll }: AttributePickerProps) {
  const [value, setValue] = React.useState<string | null>(null);
  return <Cascader scopeKey={scopeKey} items={initialItems}
    value={value} onValueChange={setValue} getChildren={loadLevel}
    onSearch={searchAll} label="Organization attribute">
    <CascaderTrigger><CascaderValue placeholder="Choose an attribute…" /></CascaderTrigger>
    <CascaderContent><CascaderPanel>
      <CascaderInput placeholder="Search every attribute…" />
      <CascaderBreadcrumb />
      <CascaderList><CascaderItems /></CascaderList>
    </CascaderPanel></CascaderContent>
    <CascaderSelectionChips />
  </Cascader>;
}
```

This is a complete UI adapter; the application supplies authorized `loadLevel`
and `searchAll` functions. It is not a supplied backend attribute-registry route.
Key the parent that owns `value` by the authorization/document identity when
immediate reset is required; a React effect alone is not an authority fence.

Superseded searches, closed popovers, scope/source changes and unmount do not
admit late responses into the current panel, even if an external loader ignores
its signal. Cancellation saves unnecessary work; a distinct source generation
also fences stale navigation and footer completions, including an A→B→A scope
transition. A successfully completed app-owned mutation is not rolled back by
this UI fence.
`scopeKey` identifies the UI/cache lifetime, not permission to access that scope.
Controlled selection belongs to the parent and must be reset there too. Use the
normal [authorization boundary](../runtime/authorization-scope-boundary.md) for actual application
scope ownership and server enforcement.

## Full-Path Chips And Custom Summaries

`CascaderSelectionChips` is optional. Place it inside `Cascader` but outside
`CascaderContent` to keep selected values visible after the popup closes.
Chips use the entire label path and have individually labeled removal controls.
They use `label` for the accessible group name and `emptyLabel` for optional
empty-state copy.

For a custom summary, `useCascaderSelection<T>()` returns:

| Member | Meaning |
| --- | --- |
| `items` | Selected entries containing `value`, `node`, full node `path`, `labelPath` and formatted `pathLabel`. |
| `values` | Current selected IDs, in selection order. |
| `remove(value)` | Request removal of one selection. |
| `clear()` | Request clearing the selection. |
| `isSelected(value)` | Check a selected ID. |
| `disabled` | Whether the field currently disallows edits. |

The hook requires the surrounding Cascader provider. Unknown controlled IDs
can only fall back to their raw value until the matching node/path is known.
Supply selected nodes in `items`, load their level, or return their path through
remote search when restoring persisted selections; the component cannot infer
a readable path from an opaque string.

For example, this optional custom presentation renders each selection with its
complete path. Render it as a child of the same Cascader root, outside its popup.

```tsx
import { useCascaderSelection } from '@zero/framework/components/cascader';
import { Button } from '@zero/framework/components/ui/button';

export function SelectedPaths() {
  const { items, remove, disabled } = useCascaderSelection();
  return <ul aria-label="Selected attributes" className="flex flex-wrap gap-2">
    {items.map(item => <li key={item.value}
      className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
      <span>{item.pathLabel}</span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled}
        aria-label={`Remove ${item.pathLabel}`} onClick={() => remove(item.value)}>
        Remove
      </Button>
    </li>)}
  </ul>;
}
```

## Composition, Configuration And Interaction

| Part | Responsibility |
| --- | --- |
| `Cascader` | Tree, selection mode, cap, scope, async loading/search and optional form field. |
| `CascaderTrigger`, `CascaderValue` | Trigger and selected-path/placeholder presentation. |
| `CascaderContent` | Popover positioning and dismissal. |
| `CascaderPanel` | Bounded search/list/footer composition. |
| `CascaderInput`, `CascaderBreadcrumb` | Search text and current drill-down trail. |
| `CascaderList`, `CascaderItems` | Bounded results, branches, selectable leaves and loading/retry states. |
| `CascaderFooter`, `CascaderAction`, `CascaderImportMenu` | Persistent commands and an optional side-anchored menu. |
| `CascaderSelectionChips`, `useCascaderSelection` | Optional external selection presentation. |

| Root prop | Default | Contract |
| --- | --- | --- |
| `items` | Required | Known root nodes. Keep the source reference stable between renders unless replacing the source intentionally. |
| `children` | Required | Composed trigger/panel/chips within one provider. |
| `multiple` | `false` | Choose string/null single selection or readonly string-array multiple selection. |
| `value`, `onValueChange` | Local state when omitted | Optional parent-owned selection and synchronous change notification. |
| `defaultValue` | Empty | Initial local selection; not a subsequent configuration channel. |
| `max` | No cap | Multi-select only; a nonnegative safe integer. Zero prevents additions. |
| `disabled`, `readOnly` | `false` | Prevent selection edits; not Guardian policies. |
| `label` | `Choose attributes` | Accessible field name. |
| `id` | Instance-generated | Field identity for accessible composition. |
| `name` | None | Optional submitted form-field name. |
| `open`, `onOpenChange` | Local state when omitted | Optional parent-owned popup visibility and change notification. |
| `defaultOpen` | `false` | Initial local popup visibility. |
| `scopeKey` | None | Retire cache/navigation/request lifetime for another scope; not authorization. |
| `getChildren` | None | Asynchronous root/branch loader with an AbortSignal. |
| `onSearch` | Local tree search | Asynchronous complete-path search for unloaded choices. |
| `searchDebounce` | `150` | Integer delay from 0 through 60,000 milliseconds before remote search. |
| `onLoadError` | None | Optional safe structured loader-error notification; no raw callback exception. |

The source reference, loader adapters and `scopeKey` together identify cached
data. Memoize an app-owned transformed tree and callback adapters when their
source has not changed. Replacing `items`, `getChildren` or `onSearch` retires
loaded levels, search paths, navigation and pending UI completions. Initial
`defaultValue` survives mounting; a later `scopeKey` change clears uncontrolled
selection. Controlled values remain the parent's responsibility. These are
React composition props, not new app config, environment variables or Doctor
discovery settings.

With `name`, the hidden form fields submit the selected value. Multiple mode
emits one field per selection; use `FormData.getAll(name)` to obtain them.
Empty single selection submits an empty string; empty multiple selection emits
no selected-value fields. Disabled fields do not participate in form submission.
This does not install native `required` validation or persist a selection.

`onLoadError` receives `CascaderLoadError` with the safe code
`CASCADER_LOAD_FAILED`, `operation: 'children' | 'search'`, and a user-facing
`message`, not the adapter's raw exception. Loading failures are observed with
`FRONTEND_CASCADER_LOAD_FAILED`; notification/footer/selection callback failures
use `FRONTEND_CASCADER_CALLBACK_FAILED`. No raw node, query, selected value or
callback exception is attached to those observations.

`CascaderAction` and import actions accept synchronous or asynchronous callbacks.
Their pending state blocks duplicate invocation. Awaited UI completion is not a
server write receipt: callbacks still need the domain's acknowledged mutation,
revision and scope checks. Failures use safe UI feedback and Zero's frontend
observability boundary, without emitting raw selection data or exception payloads.

For each import action, provide a stable `id`, readable `label`, optional `icon`
and `disabled`, and the app-owned `onSelect` callback. The menu's `label` defaults
to **Import** and its `disabled` prop can narrow availability. A disabled item
is a presentation restriction, not a server-side permission check.

Use a meaningful `label` rather than relying on placeholder text for an
accessible name. The underlying Command supports Up/Down navigation and Enter.
Right drills into the highlighted branch at the end of the input; Left goes
back at the start. Backspace on an empty query also goes back. These level keys
do not steal ordinary text-caret movement. The breadcrumb/back buttons provide
the same navigation without keyboard shortcuts. Escape dismisses the
topmost overlay before the enclosing popup, and dismissal returns focus to its
trigger. Do not add unrelated interactive controls inside a selectable row;
the packaged multi-select row already owns its checkbox and keyboard behavior.
Test keyboard focus, retry, cap removal and import-menu return in your consuming
layout, including constrained widths, light/dark themes and reduced motion.

## Security And Related Guides

Only provide attributes, schema names or permission choices the viewer may see.
UI caps, hidden actions, disabled rows and `scopeKey` do not confer authority.
Use Guardian for live grants and Zero's SDK for authenticated data transport;
keep authorization on the server even when this picker narrows visible choices.

- [DataTable](../data-controls/data-table/index.md): put the picker into a filter/control slot.
- [JSON editor](./json-editor.md): edit structured local documents instead of
  selecting one attribute.
- [Guardian](../guardian/index.md): own registration, scope and permission semantics.
- [Observability](../observability.md): configure the shared browser event sink.
- [Design tokens](../design-system/tokens.md): customize semantic colors consistently.
