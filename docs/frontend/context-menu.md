# Context Menu

[Frontend index](./README.md) · [Component inventory](./component-inventory.md)

Context Menu is Zero's conventional rectangular right-click menu. It opens
near the pointer and groups actions, boolean choices, exclusive choices and
nested commands. Its compact surfaces, icons, highlighted/disabled states,
destructive color and restrained entrance animation use Zero's
[design tokens](./design-tokens.md).

**Availability:** Context Menu is included in Zero 2.4.0, not the older 2.3.0
archive. Update before using these public imports. It leaves the existing
DropdownMenu and RadialMenu families unchanged.

Use ContextMenu for a row, file, canvas item or another focused target.
Keep a visible action/overflow alternative for touch users and discoverability;
a right-click menu must not be the only way to reach critical operations.

## Imports And Prerequisites

All parts and matching Props types are exported from
`@zero/framework/components/context-menu`, `@zero/framework/react` and the
framework root. The normal Zero stylesheet/theme is required for presentation.
No AppProvider, environment configuration, backend route or database is needed
for local interaction.

The underlying Radix engine owns positioning, keyboard traversal, typeahead,
long-press, checkbox/radio semantics and dismissal. Zero adds styling,
adornment slots, indicator placement and explicit keyboard opening.

## Icons, Counts And A Checked Item

Complete controlled-choice example; callbacks do not perform persistence:

```tsx
import { useState } from 'react';
import { Badge } from '@zero/framework/react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
  ContextMenuShortcut,
} from '@zero/framework/components/context-menu';
import { Copy, Check, Trash } from '@zero/framework/icons';

export function RecordContextMenu({ children, copy, requestDelete }: {
  children: React.ReactNode;
  copy: () => void;
  requestDelete: () => void;
}) {
  const [pinned, setPinned] = useState(false);
  return <ContextMenu>
    <ContextMenuTrigger className="block rounded-md border border-dashed p-4"
      aria-label="Record actions">
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent aria-label="Record actions">
      <ContextMenuLabel>Record</ContextMenuLabel>
      <ContextMenuItem icon={<Copy className="text-primary" />} onSelect={copy}
        endAdornment={<Badge variant="secondary">4</Badge>}>Copy</ContextMenuItem>
      <ContextMenuCheckboxItem icon={<Check />} checked={pinned}
        onCheckedChange={value => setPinned(value === true)} indicatorPosition="right">
        Pinned
      </ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Trash />} variant="destructive" onSelect={requestDelete}
        endAdornment={<ContextMenuShortcut>⌘⌫</ContextMenuShortcut>}>
        Delete…
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
```

The trigger opens on native right-click, touch/pen long-press, Shift+F10 or the
ContextMenu key. It defaults to tabIndex0 unless disabled or explicitly
overridden. `asChild` can retain an existing focusable row/button/link without
adding an invalid DOM wrapper; compose only one ref/handler-forwarding child.
Preventing the trigger's key/contextmenu event preserves the application's
decision not to open it. Repeated or unrelated modifier keys do not dispatch
extra keyboard opens.

`icon` is a leading decorative slot and `endAdornment` is right-aligned
metadata in left-to-right layouts. Counts, badges, icons and shortcut hints can
be composed there. Direct children can also compose richer content; supply
`textValue` when their text needs an explicit typeahead label. Use token
classes such as `text-primary`, `text-success` and `text-destructive` for
colored icons, not new fixed palettes.

`ContextMenuShortcut` only displays information. Showing “⌘⌫” does not
register that keyboard command. Disabled items do not select; destructive
styling is a warning, not a confirmation dialog or a permission check.

## Nested Commands And Exclusive Choices

Complete local-state example:

```tsx
import { useState } from 'react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator,
} from '@zero/framework/components/context-menu';
import { Copy } from '@zero/framework/icons';

export function ViewContextMenu({ exportAs }: {
  exportAs: (format: 'json' | 'csv') => void;
}) {
  const [view, setView] = useState('list');
  return <ContextMenu>
    <ContextMenuTrigger className="block rounded-md border p-4" aria-label="View actions">
      Right-click or press Shift+F10 for view actions
    </ContextMenuTrigger>
    <ContextMenuContent aria-label="View actions">
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<Copy />} endAdornment="2">Export</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => exportAs('json')}>JSON</ContextMenuItem>
          <ContextMenuItem onSelect={() => exportAs('csv')}>CSV</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuRadioGroup value={view} onValueChange={setView}>
        <ContextMenuRadioItem value="list" indicatorPosition="right">List</ContextMenuRadioItem>
        <ContextMenuRadioItem value="grid" indicatorPosition="right">Grid</ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>;
}
```

Submenus compose recursively. Their chevrons and keyboard direction follow
`dir`; hover intent and arrow traversal remain Radix-owned. Radio-group
values must match unique item values. Checkbox items support true, false and
`'indeterminate'`; the mixed state has a minus indicator and correct menu
checkbox semantics.

`indicatorPosition="left"` is the default; `"right"` places the check/dot
after the label and metadata. These names describe left-to-right appearance;
logical start/end placement mirrors in RTL. Leading icons remain usable in
both configurations.

## Public Parts And Configuration

All options are React props evaluated locally.

| Part | Contract/defaults |
| --- | --- |
| `ContextMenu` | Native root `onOpenChange`, `dir`, `modal` (native default true). Its root is uncontrolled; no `open` or `defaultOpen` prop is invented. |
| `ContextMenuTrigger` | Native trigger handlers/ref, `asChild`, `disabled`; Zero adds keyboard opening and default tabIndex0 for enabled targets. |
| `ContextMenuContent` | Native content/focus/collision props; automatic `portal=true`, optional `container`, `forceMount`; `collisionPadding=8`. Pointer placement belongs to Radix, not unsupported root `side`/`align` props. |
| `ContextMenuItem` | Native action props/ref including `disabled`, `textValue`, `onSelect`, `asChild`; `variant=default` or destructive; `icon`, `endAdornment`, `inset`. |
| `ContextMenuCheckboxItem` | Native checked/change/select/ref props; same adornments, `inset`, `indicatorPosition=left`. |
| `ContextMenuRadioGroup` | Native value/defaultValue/onValueChange/ref props. |
| `ContextMenuRadioItem` | Native value/disabled/select/ref props; same adornments, `inset`, `indicatorPosition=left`. |
| `ContextMenuSub` | Native submenu `open/defaultOpen/onOpenChange`; this controlled contract is distinct from the root. |
| `ContextMenuSubTrigger` | Native handlers/ref, disabled/asChild, adornments/inset and automatic chevron. |
| `ContextMenuSubContent` | Native offsets/collision props; automatic portal, container/forceMount; `sideOffset=4`, `collisionPadding=8`. Side/direction follow Radix; unsupported side/align overrides are not added. |
| `ContextMenuPortal` | Explicit native portal, container and forceMount; use content `portal={false}` inside it. |
| `ContextMenuGroup`, `Label`, `Separator` | Native semantic parts/ref; label inset optional; separator color is theme-token/className configurable. |
| `ContextMenuShortcut` | Native span props/ref, trailing display only. |
| `ContextMenuItemIndicator` | Native optional/custom checkable-item indicator. |
| `ContextMenuArrow` | Optional native arrow with popover fill; native size props remain available. |

Content is bounded by the available viewport height and width, scrolls inside
its own surface, and defaults to a 12rem minimum / 24rem maximum width subject
to available space. Use `className` to adjust dimensions while keeping overflow,
focus, contrast and collision behavior. Menus animate their entrance for 120ms;
reduced-motion preference removes that entrance movement. Closing follows the
native unmount lifecycle immediately rather than delaying focus with an exit
animation. Portal rendering is SSR-safe; interactive targets must hydrate.

No component automatically fetches options, registers commands, confirms a
destructive operation or grants [Guardian authority](../auth/README.md).

## Portals, Dialogs And Focus Handoff

Automatic portals normally mount content in the document body. Supply a
`container` when the owning dialog/surface requires another portal location.
For an explicit `ContextMenuPortal`, set nested content `portal={false}` to
avoid a second portal. Use `forceMount` only when the application deliberately
owns retained mounting/visibility; it is not an always-open setting.

When a menu command opens another overlay, coordinate that command with
`ContextMenuContent.onCloseAutoFocus`. Opening an editor while the old menu
is restoring focus can immediately dismiss the editor. The following complete
local component hands the command off after the menu close-focus lifecycle:

```tsx
import { useRef } from 'react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from '@zero/framework/components/context-menu';

export function EditContextTarget({ onEdit }: { onEdit: () => void }) {
  const wantsEditor = useRef(false);
  return <ContextMenu>
    <ContextMenuTrigger aria-label="Editable record actions" className="block border p-4">
      Editable record
    </ContextMenuTrigger>
    <ContextMenuContent onCloseAutoFocus={event => {
      if (!wantsEditor.current) return;
      wantsEditor.current = false;
      event.preventDefault();
      queueMicrotask(onEdit);
    }}>
      <ContextMenuItem onSelect={() => { wantsEditor.current = true; }}>
        Edit…
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
```

The application still owns the editor's lifetime, current record/scope and
focus return. Dismissed menus must not target a successor organization or record.
For real async commands, reserve pending work in the owning controller, await
the authorized mutation and use its established safe error/observability path.
An onSelect callback is not an acknowledgment or an automatic async-action runner.
`event.preventDefault()` on selection can keep a menu open when that is deliberate.

## Verification And Compatibility

Verify native right-click/keyboard/touch opening, typeahead/arrow traversal,
Escape/outside dismissal and focus return, checkbox/radio changes, disabled
items, nested menus, RTL, collision edges and long-menu scrolling. Test dialog
handoff in the composition actually used by the app. The isolated regression
fixture uses synthetic controls and callbacks, not live files or user accounts.

This is an additive public family, not a replacement or behavioral change for
the existing dropdown/radial menus. There is no database migration or app-wide
automatic conversion of existing context handlers.

## Related Guides And Next Steps

- [Button Group](./button-group.md) supplies visible joined and split-action alternatives.
- [Data Studio](../data-studio.md) owns schema/record mutations and revision conflicts.
- [Master/detail](./master-detail.md) owns selected-record and action-bar composition.
