---
id: zero.frontend.overlays.tooltip
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: tooltip
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

# The Public Tooltip Family

[Overlays index](./index.md) · [Documentation index](../../../index.md)

The supported generic tooltip import is **@zero/framework/components/tooltip**,
not root/react. It exports Tooltip, TooltipTrigger, TooltipContent and matching
Props types. Tooltip wraps its own Radix provider, default delayDuration0;
an extra public TooltipProvider is not required or exported by that family.

Complete description example:

```tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@zero/framework/components/tooltip";

export function HelpControl() {
  return <Tooltip>
    <TooltipTrigger asChild><Button aria-label="Show help" variant="outline">?</Button></TooltipTrigger>
    <TooltipContent>Explain this operation.</TooltipContent>
  </Tooltip>;
}
```

The tooltip text supplements an accessible control name; it is not the only
way a user can identify the operation. Do not put interactive menus/inputs or
critical error instructions solely inside a tooltip.

## State And Position

Tooltip accepts underlying controlled open/defaultOpen/onOpenChange and
delayDuration. followCursor defaults false and can be true, x or y; spring
options default stiffness200/damping17. Content supplies portal/arrow and
forwarded positioning/collision/Motion props, with spring300/damping25.
Trigger combines caller mouse-move behavior with cursor tracking.

## Two Different Implementations

Sidebar internally uses a shared Animate/Floating UI tooltip provider that
coordinates one moving tooltip between collapsed menu entries. Its private
provider/context is not interchangeable with this public Radix family.
Importing source-local wrappers to expose it is not a supported shortcut.
[Sidebar menu](./sidebar-menu.md) owns its collapsed-tooltip behavior.

Verify keyboard/focus/pointer descriptions, escape/outside behavior, viewport
placement and target browser animation. These docs inspect source; they do not
claim complete screen-reader qualification. [Popover](./popover.md) is the
interactive-panel alternative and [configuration](./configuration.md) owns
public paths/defaults.
