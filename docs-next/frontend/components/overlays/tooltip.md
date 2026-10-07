---
id: zero.frontend.overlays.tooltip
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: tooltip
maturity: supported
applies_to: ["2.6.0"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# The Public Tooltip Family

[Overlays index](./index.md) · [Documentation index](../../../index.md)

The supported generic tooltip import is **@zero/framework/components/tooltip**,
not root/react. It exports Tooltip, TooltipTrigger, TooltipContent and matching
Props types. Tooltip wraps its own Radix provider, with `delayDuration: 0`;
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
The [shared keyboard hints](../kbd.md) can display a compact command hint
inside this surface, with inherited tooltip colors and no new focus target.

## State And Position

`Tooltip` accepts Radix's controlled `open`/`defaultOpen`/`onOpenChange` and
`delayDuration`. `followCursor` defaults to `false` and can be `true`, `'x'` or
`'y'`; its spring defaults to stiffness 200 and damping 17. Content supplies
the portal and arrow and forwards positioning, collision and Motion props,
with a spring of stiffness 300 and damping 25. Trigger combines caller
mouse-move behavior with cursor tracking.

`TooltipContent` accepts `side`, `sideOffset`, `align`, `alignOffset`,
`avoidCollisions`, `collisionBoundary`, `collisionPadding`, `arrowPadding`,
`sticky` and `hideWhenDetached`. These control preferred placement and collision
handling, not fixed coordinates. Radix can flip or shift the content when its
preferred side would leave the boundary. Keep collision handling enabled for
ordinary viewport-aware hints; disable it only when the application deliberately
owns a different placement contract.

The styled content defaults to `collisionPadding: 8` and a maximum width of the
smaller of 20rem and Radix's available width; its fallback viewport cap leaves
1rem of horizontal space. Normal whitespace and `overflow-wrap: anywhere` keep
long words inside that width, so long labels do not require application CSS
selectors. Use `className` for a narrower content width when appropriate. The portal avoids
clipping by a scrolling sidebar or another overflow container. A custom
`collisionBoundary` still takes precedence over the normal viewport boundary.

## Sidebar Integration

Collapsed desktop [Sidebar menu buttons](./sidebar-menu.md) use this same public
Radix family on the actual button or link. Sidebar hints are hover-only,
independently of decorative hover highlighting: keyboard focus alone does not
open them. Clicking a sidebar control dismisses its hint until the pointer
leaves and hovers again, while the accessible control name remains available.
This sidebar-specific behavior does not change ordinary public tooltips, which
retain their standard keyboard-focus interaction. Sidebar defaults are a
right-side, centered preference with `sideOffset: 6`, `collisionPadding: 8` and
`hideWhenDetached: true`; the `tooltip` content-props object can override them.
Expanded or mobile sidebars suppress the hint without replacing the underlying
control.

The internal shared Animate/Floating UI provider remains an implementation
compatibility path, not the renderer used by current sidebar menu tooltips.
Its context is not interchangeable with this public Radix family. Do not import
source-local providers or wrappers to implement ordinary application hints.

Verify keyboard/focus/pointer descriptions, escape/outside behavior, viewport
placement and target browser animation. These docs inspect source; they do not
claim complete screen-reader qualification. [Popover](./popover.md) is the
interactive-panel alternative and [configuration](./configuration.md) owns
public paths/defaults.
