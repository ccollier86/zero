---
id: zero.frontend.drawers
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: managed-drawers
maturity: preview
applies_to: ["2.6.0 workflow integration contracts; identify the source commit and archive hash"]
modes: [browser, SSR, AppShell, contained, viewport]
---

# Managed Drawers And Workspace Inspectors

[Frontend index](../index.md) · [Managed modals](../modals/index.md) · [UI reference](../ui-reference.md)

Use `@zero/framework/drawers` for a managed inspector or edge panel. `drawers`,
`useDrawers`, `DrawerWorkspace`, `DrawerManager` and `ControlledDrawer` are also
exported by the root and React facade. They reuse the existing ModalManager,
store, exact-ID handles, contexts, form guards, owned popovers, theme and Arc
scroll treatment. There is no second overlay stack or focus/scroll owner.

The initial implementation supplies four sides, contained desktop inspection
and a modal bottom-sheet presentation when opened on a narrow screen. Gesture
detents, elastic dragging and snap-point APIs remain in the
[advanced sheet plan](../../_work/drawer-bottom-sheet-system-plan.md).
This basic sheet is not advertised as a gesture/detent component.

## AppShell Workspace Composition

```tsx
import { DrawerWorkspace, useDrawers } from '@zero/framework/drawers';
import { Button } from '@zero/framework/react';

function WorkflowCanvas() {
  const drawers = useDrawers();
  return <Button onClick={event => {
    const inspector = drawers.show<string>({
      title: 'Function inputs', trigger: event.currentTarget,
      reserveSpace: true,
      body: context => <>
        <p>Use the admitted function schema and the app-owned form controller.</p>
        <Button onClick={() => context.show({ title: 'Test details', body: 'Synthetic detail' })}>Test details</Button>
      </>,
      actions: [{ id: 'done', label: 'Done', value: 'done', variant: 'primary' }],
    });
    void inspector.result.then(result => {
      if (result.kind === 'accepted') { /* Observe the acknowledged presentation result. */ }
    });
  }}>Inspect function</Button>;
}

export function WorkflowWorkspace() {
  // Put this inside AppShell's main workspace, not around its navigation.
  return <DrawerWorkspace style={{ height: '70vh' }}><WorkflowCanvas /></DrawerWorkspace>;
}
```

The workspace supplies its bounds and optional left/right content reservation.
A desktop inspector defaults to nonmodal inside that workspace: the canvas and
AppShell navigation stay usable, with no page dimming or global scroll lock.
The frame is portalled outside inert/receding app ancestors and follows the
workspace's measured rectangle on resize/scroll. Menus can escape its clipping
area through the existing owner-aware portal.

Outside a workspace, `drawers.show` defaults to a modal viewport panel. A
standalone `DrawerManager` is available; inside AppShell it inherits the normal
host. Do not install another store or focus trap. `useDrawers` also inherits an
active overlay parent for nested drawers. Explicit global calls can supply
`parentId`; modal children use the body's `context.show`.

## Options And Anatomy

| Option | Default and behavior |
| --- | --- |
| `side` | `right`; also left, top and bottom. |
| `mode` | Nonmodal with a supplied workspace/container, modal otherwise. |
| `mobile` | `bottom-sheet`; `modal` retains the configured side with modal admission, `same` retains desktop modality. |
| `container` | Supplied by `useDrawers`; an explicit same-document connected element is also accepted. Null chooses a global panel. |
| `reserveSpace` | False. True reserves left/right canvas width for a contained nonmodal inspector. |
| `width` | `var(--zero-drawer-width,24rem)`; always capped by its actual host width. |
| `sheetHeight` | `var(--zero-drawer-sheet-height,85dvh)`; top/bottom panels stay bounded by available height. |
| `motion` | Edge-facing entrance/reverse exit, page recession off; shared duration multiplier, backdrop and reduced-motion policy. A drawer does not morph from a button. |
| `closeOnClickOutside` | False for a nonmodal inspector, true for a modal panel unless overridden. |

Opening-time responsive modality is retained for that generation, so resizing
does not remount an editor and lose its draft. Dimensions still track the host.
Closing/reopening or a deliberate structural update admits the current viewport
policy. Keep accepted/domain state in the ordinary form/controller layer.

Header, description/icon, small close glyph, actions, footer and independently
scrolling body use the modal descriptor's existing anatomy. `layout: 'tabs'`
with `sections` supplies retained Inputs/Settings/Test panels and the shared
magnetic highlight. Do not reconstruct headers or put another scroller around
the already decorated body. Existing modal theme roles are inherited; optional
drawer width/sheet-height and enter/exit millisecond properties refine only this
surface. Enter/exit bases are 320/240ms, scaled by the admitted duration multiplier.
The additive drawer skin is bundled with the managed renderer and platform
stylesheet; the original modal skin and legacy theme files remain unchanged.

## Guards And Exact Outcomes

`DrawerHandle` supplies `id`, `result`, `close(value)`, `dismiss(reason?)`,
`update(updates)` and `replace(descriptor)`. Accepted, dismissed and retired
results have the same meanings as managed modals. Busy work and dirty/form
guards remain on the shared owner; retirement is authoritative and cannot be
blocked by a stale guard.

Use `await handle.replace(nextDescriptor)` for a user-selected node replacement.
It first obtains guarded dismissal; rejected, pending or retired admission
returns null without opening another inspector. A successful replacement
preserves drawer geometry unless overridden and aborts old callbacks. Do not
silently force-close an unsaved inspector when another canvas node is clicked.

`ControlledDrawer` accepts the existing ControlledModal lifecycle props with a
drawer descriptor. Ordinary body/action updates retain the opening. Its
`identityKey` denotes an **authoritative** target replacement and retires the
old generation, not an advisory user discard decision. For user-selected changes,
obtain the close/replacement guard first. On workspace unmount or Guardian
scope retirement, private content and owned descendants retire immediately.

Closing a drawer is not proof that a network write was cancelled. Pending
actions still require real acknowledgement or reconciliation through the owning
service. No drawer creates a database client, subscription or writer itself.
