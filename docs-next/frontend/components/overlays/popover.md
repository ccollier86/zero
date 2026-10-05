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
applies_to: ["2.1.1 source with audited interaction/token corrections; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Small Interactive Panels With Popover

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Popover is appropriate for a filter panel or short local editor. Public root/
react and /components/popover export Popover, PopoverTrigger, PopoverContent,
PopoverClose and their matching Props types. The wrapper owns its portal.

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
does not expose private Anchor/Arrow/Portal/usePopover APIs.

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
