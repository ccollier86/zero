---
id: zero.frontend.components.button-group
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: button-group
maturity: supported
applies_to: ["Zero 2.4.0 Button Group; not in the older 2.3.0 archive"]
modes: [browser, SSR, actions, single-selection, multi-selection]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.0"
  commit: "fdba48af9dcbab96ddeb3aa3b49f070a8c8a81a6"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: implementation-verified
---

# Button Group

[Primitive index](./index.md) · [Component index](../index.md) · [Documentation index](../../../index.md)

Button Group brings related controls together without changing what those
controls do. Use it for compact toolbars, split actions, pagination, input
addons, zoom controls and view selectors. It composes existing Zero Button,
Input, Select, Badge and DropdownMenu components rather than replacing them.

**Availability:** Button Group is included in Zero 2.4.0. It is not in the older
2.3.0 archive; update before using these public imports. Existing applications
need no database migration.

## Imports And Prerequisites

Import from `@zero/framework/components/button-group`, `@zero/framework/react`
or the framework root. Load the normal Zero stylesheet and theme setup;
[design tokens](../../design-system/index.md) own colors, radius and light/dark presentation.
No AppProvider, server route, environment setting or database is required for
local grouping or selection.

The two behaviors are deliberately separate:

- `ButtonGroup` groups independent actions and fields. It has no selection state.
- `ButtonGroupToggle` owns single/multiple selection through Radix. It is not a
  tab-panel controller and does not fetch or persist anything.

## Joined Actions And A Count

Complete local presentation component:

```tsx
import { Button, Badge } from '@zero/framework/react';
import {
  ButtonGroup, ButtonGroupText, ButtonGroupSeparator,
} from '@zero/framework/components/button-group';
import { Copy, Trash } from '@zero/framework/icons';

export function DocumentActions({ count, copy, remove, pending }: {
  count: number;
  copy: () => void;
  remove: () => void;
  pending: boolean;
}) {
  return <ButtonGroup aria-label="Document actions">
    <Button type="button" variant="outline" onClick={copy} disabled={pending}>
      <Copy /> Copy
    </Button>
    <ButtonGroupSeparator />
    <Button type="button" variant="outline" onClick={remove} disabled={pending}>
      <Trash className="text-destructive" /> Delete
    </Button>
    <ButtonGroupText><Badge variant="secondary">{count}</Badge></ButtonGroupText>
  </ButtonGroup>;
}
```

The group joins the controls' corners and borders. Separators remain distinct;
focus rings stack above neighboring controls. Icons keep the Button's existing
animation behavior. Icon-only actions still need an accessible name and, where
helpful, an existing Zero Tooltip.

The callbacks above are application-owned, not a deletion implementation.
Use the owning domain's confirmation, pending and acknowledged-mutation
contract before deleting persistent data.

## Split Buttons, Inputs And Nested Groups

Complete composition example. The final dropdown is a separate, named action,
not an unlabeled extension of the primary button:

```tsx
import {
  Button, Input, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuItem,
} from '@zero/framework/react';
import { ButtonGroup, ButtonGroupText } from '@zero/framework/components/button-group';
import { ChevronRight } from '@zero/framework/icons';

export function ExportControls({ exportAs }: {
  exportAs: (format: 'json' | 'csv') => void;
}) {
  return <ButtonGroup spacing="separated" aria-label="Export controls" className="max-w-full">
    <ButtonGroup aria-label="Export filename" className="min-w-0 flex-1">
      <ButtonGroupText>File</ButtonGroupText>
      <Input aria-label="Export filename" defaultValue="records" className="min-w-0" />
    </ButtonGroup>
    <ButtonGroup aria-label="Export format">
      <Button type="button" variant="outline" onClick={() => exportAs('json')}>
        Export JSON
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Choose export format">
            <ChevronRight />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => exportAs('json')}>JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportAs('csv')}>CSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  </ButtonGroup>;
}
```

Select triggers, text/count addons and native controls can be mixed in the same
way. Nested groups keep their own orientation. Use separated outer groups to
distinguish logical clusters; use `orientation="vertical"` for stacked palettes.
Joined groups do not automatically wrap their controls into multiple lines.
Keep controls compact, use an overflow menu or deliberately choose a vertical
layout for narrow surfaces.

## Single And Multiple Selection

Complete controlled-state example:

```tsx
import { useState } from 'react';
import {
  ButtonGroupToggle, ButtonGroupToggleItem,
} from '@zero/framework/components/button-group';

export function ViewAndFormatting() {
  const [view, setView] = useState('list');
  const [formats, setFormats] = useState<string[]>([]);
  return <div className="flex flex-wrap gap-3">
    <ButtonGroupToggle type="single" value={view}
      onValueChange={next => { if (next) setView(next); }}
      aria-label="Record view" size="sm">
      <ButtonGroupToggleItem value="list">List</ButtonGroupToggleItem>
      <ButtonGroupToggleItem value="grid">Grid</ButtonGroupToggleItem>
    </ButtonGroupToggle>
    <ButtonGroupToggle type="multiple" value={formats} onValueChange={setFormats}
      aria-label="Text formatting" variant="default">
      <ButtonGroupToggleItem value="bold">Bold</ButtonGroupToggleItem>
      <ButtonGroupToggleItem value="italic">Italic</ButtonGroupToggleItem>
    </ButtonGroupToggle>
  </div>;
}
```

Single mode uses a string value; multiple mode uses a string array. Use either
`value/onValueChange` or `defaultValue`, not both as competing owners.
Single-mode activation can clear the choice and emit an empty string. The
example deliberately ignores that value to retain a required view choice.

The installed Radix contract renders single-mode items with `role="radio"`
and `aria-checked` within a `role="group"`; multiple-mode items are buttons
with `aria-pressed`. Zero preserves that contract, roving focus and disabled
item behavior. Tab reaches the group, arrow keys move focus, and Space/Enter
activate the focused item. Orientation and direction affect navigation.
Arrow movement is focus movement, not an automatic server mutation.

There is no implicit form field. If the choice belongs in a native form, add
explicit hidden input(s) from the controlled value and validate the submitted
value through the application's normal form/schema contract.

## Public Parts And Configuration

All props resolve at render/interaction time, not through Zero app configuration.

| Part | Options and defaults |
| --- | --- |
| `ButtonGroup` | Native div props/ref; `orientation: horizontal \| vertical` defaults horizontal; `spacing: joined \| separated` defaults joined; `asChild` defaults false. |
| `ButtonGroupText` | Native div props/ref; `asChild` defaults false; `size: xs \| sm \| default \| lg` defaults default and matches the Button scale. |
| `ButtonGroupSeparator` | Existing Zero Separator props. Omitted orientation is perpendicular to the nearest group; explicit orientation wins. Decorative defaults follow Separator. |
| `ButtonGroupToggle` | Required `type: single \| multiple`; Radix value/defaultValue/change, disabled, orientation, dir, loop and rovingFocus props. Shared spacing defaults joined, size defaults default, variant defaults outline. |
| `ButtonGroupToggleItem` | Required unique `value`; native Radix item props/ref, disabled and asChild; size/variant inherit the group unless overridden. `animateIcon` defaults true through Zero Button. |
| `buttonGroupVariants` | Class composer for orientation/spacing; it does not create state or semantics. |

Toggle `variant="default"` uses a lighter ghost treatment;
`variant="outline"` uses bordered controls. Active items use primary tokens.
Size options are `xs`, `sm`, `default`, `lg`; selection items do not invent
a separate icon-width scale. Every part has its matching named Props type;
the focused entry also exports `ButtonGroupLayoutProps`,
`ButtonGroupToggleSize` and `ButtonGroupToggleVariant`.

Ordinary children keep their own Button/Input/Select sizes, variants, refs,
handlers and form behavior. The group does not clone them to silently set
disabled, selected, type or dimensions. In a form, give action buttons
`type="button"` and actual submit buttons `type="submit"` explicitly.
A group-wide native form-control lock can use `asChild` around a disabled
fieldset; this disables native form controls, not links or arbitrary widgets.
The toggle group's own `disabled` setting is passed through Radix to its items.

## Authority, Lifecycle And Verification

These components are local presentation and selection. They neither grant
[Guardian permissions](../../../backend/guardian/index.md) nor infer an organization or record boundary.
Applications own pending state, confirmation, server validation, operation
acknowledgment, safe errors and observability. A Promise returned from onClick
is not automatically awaited or deduplicated by a ButtonGroup.

Key or reset tenant/record-specific controlled state when its owning scope
changes. Do not treat a disabled action as server-side enforcement.

Check joined edges, focus rings, explicit labels, nested/control sizing,
vertical and RTL layouts, and single/multiple selection. The components are
SSR-safe; their public exports must still be verified against the exact
package being installed. Existing Buttons, dropdowns and data-table toolbars
are not rewritten or automatically converted by this additive component.

## Related Guides And Next Steps

- [Context menus](../overlays/context-menu.md) add right-click commands using the same tokens.
- [Primitive configuration](./configuration.md) explains native/headless ownership and public paths.
- [Table controls](../../data-controls/data-table/controls.md) owns query state and composition slots.
- [Forms](../../forms/index.md) owns validation and acknowledged writes.
