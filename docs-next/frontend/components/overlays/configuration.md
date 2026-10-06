---
id: zero.frontend.overlays.configuration
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: configuration
maturity: supported
applies_to: ["2.4.3 candidate with collapsed-sidebar tooltip corrections; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.3"
  commit: "8327e4498f52b12b43759bbc4618973601191039"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Overlay And Navigation Props

[Overlays index](./index.md) · [Documentation index](../../../index.md)

No env settings, DB tables or Doctor-specific overlay configuration are created.
React props and local provider state resolve at render/interaction time.

## Public Paths

| Family | Supported import | Public option shape |
| --- | --- | --- |
| DropdownMenu* | root/react or /components/dropdown-menu | named matching Props exports |
| ContextMenu* | root/react or /components/context-menu | 2.4.0 addition; named matching Props exports and [native root/portal/choice contracts](./context-menu.md#public-parts-and-configuration) |
| Popover/Trigger/Content/Close | root/react or /components/popover | named matching Props exports |
| Tooltip/Trigger/Content | /components/tooltip | TooltipProps/TriggerProps/ContentProps; **not root/react** |
| Collapsible/Trigger/Content/useCollapsible | root/react or /components/collapsible | Props and CollapsibleContextType |
| Sidebar* / useSidebar | root/react or /components/sidebar | infer React ComponentProps; no named sidebar Props barrel promised |
| RadialMenu | root/react or /components/radial-menu | RadialMenuProps/RadialMenuItem |

Private Radix/Motion portal/anchor/arrow/highlight components are not added to
those public families merely because their source files export them.
The new ContextMenu family explicitly exports its native Portal, Arrow and
ItemIndicator; this does not change the existing DropdownMenu export contract.

## Owned Defaults And Extensions

| Control | Default / specific options |
| --- | --- |
| Dropdown content | sideOffset4; spring300/damping25 in primitive; item variant default or destructive, inset optional |
| Dropdown checkbox | checked supported; inset optional; indicator wrapper supplies check icon |
| Dropdown label/subtrigger | inset optional |
| Dropdown submenu content | duration0.2s; controlled/default-open subroot and positioning options |
| PopoverContent | align center; sideOffset4; width72 utility; spring300/damping25; className/position/collision/focus callbacks |
| Tooltip | delayDuration0; followCursor false or true/x/y; follow spring200/damping17 |
| TooltipContent | inherited positioning/collision/Motion props; spring300/damping25; collisionPadding8; max width min(20rem, available width), viewport-minus-1rem fallback and word wrapping; wrapper supplies arrow/portal |
| CollapsibleContent | keepRendered false; transition duration0.35s/easeInOut |
| SidebarProvider | defaultOpen true; optional open/onOpenChange; desktop widths16rem/icon3rem |
| Sidebar | side left, variant sidebar, collapsible offcanvas, animateOnHover true; spring350/damping35 |
| Sidebar mobile | below768px; width18rem, independent mobile open state |
| SidebarMenuButton | asChild false, isActive false, variant default (outline available), size default (sm/lg); tooltip string or public TooltipContent props |
| Sidebar menu tooltip | collapsed desktop only; right/center preference, sideOffset6, collisionPadding8, hideWhenDetached true; string supplies default accessible name |
| SidebarMenuAction | asChild false, showOnHover false |
| SidebarMenuSkeleton | showIcon false |
| SidebarMenuSubButton | asChild false, size md (sm available), isActive false |
| RadialMenu | size240, iconSize18, bandWidth50, innerGap8, outerGap8, outerRingWidth12 |

Inherited root/trigger props retain their installed Radix/React contract:
open/defaultOpen/onOpenChange, disabled and asChild where declared.
In particular, ContextMenu's root is uncontrolled and observes onOpenChange;
only its submenu has an open/defaultOpen contract. Its pointer-positioned
content does not expose unsupported side/align settings. See the dedicated
[ContextMenu guide](./context-menu.md) for exact collision/offset and portal options.
Styled animated content intentionally owns its rendered Motion element;
unsupported forceMount/asChild props are not escape hatches. Native dependency
defaults not overridden by Zero remain the installed dependency's contract.

[Feature guides](./index.md) explain state/authority/lifecycle. The
[design-system configuration](../../design-system/configuration.md) owns tokens,
themes and ordinary icon triggers.
