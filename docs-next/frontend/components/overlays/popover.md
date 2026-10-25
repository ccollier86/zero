---
id: zero.frontend.overlays.popover
type: how-to
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: popover
maturity: supported
applies_to: ["2.6.0 working source; anchored surface upgrade unreleased"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Small Interactive Panels With Popover

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Popover is appropriate for a filter panel or short local editor. Public root/
react and /components/popover export Popover, PopoverTrigger, PopoverContent,
PopoverClose, optional PopoverAnchor/PopoverViewport and their matching Props types. The wrapper owns its portal.

The canonical implementation lives in `components/surfaces/popover`; supported
public imports and former Animate UI paths remain forwards to that same owner.
See [source organization](../source-organization.md), not the physical folder,
when choosing an application import or inspecting a source-copy plan.

Complete controlled example:

```tsx
import { useState } from "react";
import { Button, Popover, PopoverTrigger, PopoverContent,
  PopoverClose } from "@zero/framework/react";

export function FiltersPanel() {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline">Filters</Button></PopoverTrigger>
    <PopoverContent align="start">
      <p className="text-sm text-muted-foreground">Choose filters in this panel.</p>
      <PopoverClose asChild><Button>Done</Button></PopoverClose>
    </PopoverContent>
  </Popover>;
}
```

Root also accepts defaultOpen/local state. Trigger asChild requires one suitable
focusable child. Close delegates local dismissal, not a backend save.

## Content And Focus

Default align=center, sideOffset4, width w-72 and tokenized popover surface.
Positioning/collision options and focus/open/close/outside/Escape callbacks are
forwarded to the Radix layer; animation/Motion props style the owned div.
The wrapper supplies an animated portal with enter/exit. Public composition
does not expose private Arrow/Portal/usePopover APIs. PopoverAnchor is public
for non-toggle positioning, such as an input whose focus/query controls the
opening. It accepts Radix Anchor props/ref/asChild and supplies the same live
theme/motion origin reference as a trigger, without button or toggle semantics.
Use PopoverTrigger for actual toggle buttons; keep focus ownership deliberate
when anchoring a combobox. The blog inline search is a tested composition.

## Anchored Motion

The default panel grows from the side facing its trigger: scale .97 and a 5px
offset settle over 580ms, with a separate 160ms opacity entrance. Closing uses
scale .98 and half the offset over 140ms. The **actual collision-resolved side**
sets the direction and transform origin; Radix remains the positioning owner.
This is the restrained [Arc Popover reference](https://uiarc.dev/components/popover),
not the modal's full From Button rectangle morph. Select has its own
[trigger-to-list morphology](../controls/select.md#morph-presentation-and-rich-options).

The canonical `--zero-theme-popover-*` roles and local `--zero-popover-*` duration,
scale, offset and easing aliases support local tuning. Explicit Motion
`initial`/`animate`/`exit`/`transition` props retain their caller-owned recipe and
opt out of the default CSS recipe; no second entrance is layered over them.
Reduced motion removes travel/scale and keeps a short opacity transition.
Tooltip Grow/400ms/arrow defaults and chart inspection cards are unchanged.

One existing presence owner holds a departing surface until exit completes.
Interrupted reopen reverses the same element rather than resetting draft/focus.
The trigger's live theme is projected after modal-owner defaults and before
explicit visual styles. Owner container, layer and inactive interaction fences
remain protected; use `portalContainer` only for deliberate supported placement.
Reserved Radix positioning variables are not copied from a parent popup.

Generic Popover does not acquire menu/listbox semantics. Compose CommandList or
DropdownMenu for choices/actions; a form or readout can remain ordinary content.

## Long Content Without Nested Scrolling

Use `PopoverViewport` for the bounded body of a long generic form or readout.
It is a native div with shared content-only edge fades and sibling overlay rails;
it creates no menu state, keyboard controller or extra focus stop. Native `ref`,
classes/styles, `fadeEdges=true`, `scrollbars="hover" | "scroll" | "always" | "hidden"` and
`orientation="vertical" | "horizontal" | "both"` remain explicit.
Keep fixed headings/actions outside it and bound the outer panel in your composition.

```tsx
import { Popover, PopoverTrigger, PopoverContent, PopoverViewport,
  PopoverClose } from '@zero/framework/components/popover';

export function LongReadout({ children }: { children: React.ReactNode }) {
  return <Popover>
    <PopoverTrigger>Inspect</PopoverTrigger>
    <PopoverContent className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] flex-col gap-3 overflow-hidden">
      <h2 className="text-sm font-medium">Details</h2>
      <PopoverViewport>{children}</PopoverViewport>
      <PopoverClose>Done</PopoverClose>
    </PopoverContent>
  </Popover>;
}
```

Do **not** put this around Calendar, TimePicker, CommandList or Cascader: those
components already own and decorate their actual viewports. Generic
PopoverContent is intentionally not auto-wrapped, so existing picker/footer
layouts and specialized chart inspectors are not given a second scroller.

Do not use tooltip for interactive forms. If a mutation must be accepted before
closing, hold controlled open state until the server result and present errors
safely. No automatic retry, loading, write lifecycle or scope authorization is
added by Popover itself. Retire stale app-owned async callbacks when identity
or tenant changes.

## Verification And Related Guides

Check focus placement/return, content overflow near viewport edges, controlled
close, outside interaction and reduced-motion policy in the target app.
[Configuration](./configuration.md) owns defaults/types,
[DataTable slots](../../data-controls/data-table/index.md) explain filter-control
placement and [modals](../../modals/index.md) cover more substantial workflows.
