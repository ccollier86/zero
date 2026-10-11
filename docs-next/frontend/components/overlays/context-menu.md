---
id: zero.frontend.overlays.context-menu
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: context-menu
maturity: supported
applies_to: ["2.6.0 working source; Arc viewport adoption unreleased; original family available since 2.4.0"]
modes: [browser, SSR, pointer, keyboard, touch, RTL]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Context Menu

[Overlays index](./index.md) · [Component index](../index.md) · [Documentation index](../../../index.md)

Context Menu is Zero's conventional rectangular right-click menu. It opens
near the pointer and groups actions, boolean choices, exclusive choices and
nested commands. Its compact surfaces, icons, highlighted/disabled states,
destructive color and restrained entrance animation use Zero's
[design tokens](../../design-system/index.md).

**Availability:** Context Menu is included in Zero 2.4.0, not the older 2.3.0
archive. The additional viewport part and Arc/native choice described below
belong to unreleased 2.6.0 working source, not the historical 2.4.0 package.
The existing DropdownMenu and RadialMenu families remain separate.

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
| `ContextMenuContent` | Native content/focus/collision props; automatic `portal=true`, optional `container`, `forceMount`; `collisionPadding=8`. Standard content adds one inner Arc viewport by default; outer native ref and lifecycle handlers stay on the menu. Pointer placement belongs to Radix, not unsupported root `side`/`align` props. |
| `ContextMenuItem` | Native action props/ref including `disabled`, `textValue`, `onSelect`, `asChild`; `variant=default` or destructive; `icon`, `endAdornment`, `inset`. |
| `ContextMenuCheckboxItem` | Native checked/change/select/ref props; same adornments, `inset`, `indicatorPosition=left`. |
| `ContextMenuRadioGroup` | Native value/defaultValue/onValueChange/ref props. |
| `ContextMenuRadioItem` | Native value/disabled/select/ref props; same adornments, `inset`, `indicatorPosition=left`. |
| `ContextMenuSub` | Native submenu `open/defaultOpen/onOpenChange`; this controlled contract is distinct from the root. |
| `ContextMenuSubTrigger` | Native handlers/ref, disabled/asChild, adornments/inset and automatic chevron. |
| `ContextMenuSubContent` | Native offsets/collision props; automatic portal, container/forceMount; `sideOffset=4`, `collisionPadding=8`. Own inner Arc viewport, independent from its parent menu. Side/direction follow Radix; unsupported side/align overrides are not added. |
| `ContextMenuViewport` | Explicit native-div part for custom `asChild` content; ref, scroll and native HTML handlers address this viewport. No added tab stop, focus region or selection controller. |
| `ContextMenuPortal` | Explicit native portal, container and forceMount; use content `portal={false}` inside it. |
| `ContextMenuGroup`, `Label`, `Separator` | Native semantic parts/ref; label inset optional; separator color is theme-token/className configurable. |
| `ContextMenuShortcut` | Native span props/ref, trailing display only. |
| `ContextMenuItemIndicator` | Native optional/custom checkable-item indicator. |
| `ContextMenuArrow` | Optional native arrow with popover fill; native size props remain available. |

Content is bounded by the available viewport height and width and defaults to a
12rem minimum / 24rem maximum width subject to available space. Standard Arc
content scrolls its inner viewport, keeping the outer border, shadow and Radix
placement outside the fade. Use `className` for the frame and
`viewportClassName`/`viewportStyle` for its body. The standard 4px menu inset now
belongs to the inner viewport so full-width separators cannot create false
horizontal overflow. Put body padding overrides on that viewport; custom outer
padding remains additional frame spacing and is not automatically moved.
The native branch keeps the original outer padding. Menus animate their entrance for 120ms;
reduced-motion preference removes that entrance movement. Closing follows the
native unmount lifecycle immediately rather than delaying focus with an exit
animation. Portal rendering is SSR-safe; interactive targets must hydrate.
Existing item highlights remain unchanged; this adoption does not replace them
with the Select/Dropdown magnetic recipe.

## Scroll Treatment And Custom Content

`ContextMenuContent` and `ContextMenuSubContent` share
`ContextMenuScrollOptions`. `ContextMenuViewportProps` is the explicit part's
native-div contract, not another menu surface.

| Option | Default and ownership |
| --- | --- |
| `scrollTreatment` | `arc`; `native` selects the unchanged original content engine and outer native scrolling. |
| `orientation` | `both`; `vertical` or `horizontal` constrains the standard viewport to that axis. |
| `fadeEdges` | `true`; actual hidden distance controls each edge independently. Fitting content has no fade. |
| `scrollbars` | `hover`; also `scroll`, `always` or `hidden`. Rails appear only on overflowing axes; hidden rails do not disable fades or native scrolling. |
| `viewportRef` | Ref to the standard inner native div; content `ref` still reaches the outer menu. |
| `viewportClassName`, `viewportStyle` | Standard viewport presentation, distinct from frame props. |

The shared treatment uses [Arc edge fades and overlay rails](../primitives/scroll-area.md)
without nesting another scroller. Paging, snap-safe thumb drag and native RTL
scrolling use the private shared viewport adapter. It does not fetch items,
change typeahead, select a clipped row or snap all rows fully into view.

An opaque `asChild` host is not automatically wrapped or searched for a guessed
scroll owner. It retains native scrolling; compose `ContextMenuViewport` as a
direct child of the semantic host to opt in explicitly. The child must forward
native props and its ref as required by Radix. Put frame dimensions on that host
and viewport dimensions/handlers on the explicit part. Standard content's
`viewport*` options do not reconfigure a separately authored part.
The explicit part is intentionally unpadded. For the standard inset and original
negative-margin separators, give it `className="p-1"` and set the outer content
to `className="p-0"`; frame/body overrides otherwise remain caller-owned.
Inside a managed owner, its reserved marker, floating layer and inactive-input
guards also take precedence over direct-child props. A custom component must
forward those native props/ref and must not overwrite them internally; other
child content, handlers, identity and styling remain caller-owned.

```tsx
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuViewport,
  ContextMenuLabel, ContextMenuItem,
} from '@zero/framework/components/context-menu';

export function CustomScrollableActions({ actions }: {
  actions: { id: string; label: string; run: () => void }[];
}) {
  return <ContextMenu>
    <ContextMenuTrigger className="block rounded-md border p-4">
      Right-click for actions
    </ContextMenuTrigger>
    <ContextMenuContent asChild className="p-0">
      <section className="max-h-64" aria-label="Available actions">
        <ContextMenuViewport className="p-1" orientation="both" fadeEdges scrollbars="hover">
          <ContextMenuLabel>Actions</ContextMenuLabel>
          {actions.map(action => <ContextMenuItem key={action.id}
            onSelect={action.run}>{action.label}</ContextMenuItem>)}
        </ContextMenuViewport>
      </section>
    </ContextMenuContent>
  </ContextMenu>;
}
```

For comparison or rollback, use `scrollTreatment="native"` without the new
viewport part. Original source files stay available until replacement testing
and explicit retirement approval; source-copy preserves customized originals
unless the user deliberately requests overwrite.

No component automatically fetches options, registers commands, confirms a
destructive operation or grants [Guardian authority](../../../backend/guardian/index.md).

## Portals, Dialogs And Focus Handoff

Outside an owned overlay, automatic portals normally mount content in the
document body. Arc content inside a managed modal inherits its owner's portal
container, live theme and protected floating layer. Only an actually open menu
registers in Zero's owned-floating-branch registry; closing releases that
registration. A lower/inactive modal's menu is inert and cannot
intercept input. Supply an explicit `container` to retain caller positioning;
`portal={false}` still disables the automatic portal.
The `native` rollback branch keeps the original manual container/layer contract
rather than silently adopting this new owner bridge.
For an explicit `ContextMenuPortal`, set nested content `portal={false}` to
avoid a second portal. Use `forceMount` only when the application deliberately
owns retained mounting/visibility; it is not an always-open setting. A closed
force-mounted native modal menu can retain Radix's `hideOthers`, outside-scroll
lock and dismissal layer until the caller retires it. A force-mounted submenu
also retains its native dismissal layer. Visually hiding it or releasing Zero's branch
registration is not equivalent to native unmount. Retire explicit retention
after its intended exit before relying on the parent's Escape/accessibility
handoff. New viewport rails become inactive while closed; the scroll adapter
does not rewrite those retained native modal semantics.

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
The [bounded adoption ledger](../../../_work/arc-scroll-surface-plan.md)
records current original-byte, browser, copied-source and installed-package
qualification separately from the wider surface queue.

This is an additive public family, not a replacement or behavioral change for
the existing dropdown/radial menus. There is no database migration or app-wide
automatic conversion of existing context handlers.

## Related Guides And Next Steps

- [Dropdown menus](./dropdown-menu.md) provide visible click-triggered actions and choices.
- [Button groups](../primitives/button-group.md) provide joined/split visible controls.
- [Overlay configuration](./configuration.md) explains provider and import boundaries.
- [Modals](../../modals/index.md) owns deliberate confirmation/editor flows.
- [Data Studio](../../data-studio/index.md) owns schema/record mutation authority.
