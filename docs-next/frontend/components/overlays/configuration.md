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
applies_to: ["2.6.0 working source; anchored/menu/tooltip upgrades unreleased"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
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
| Popover/Trigger/Content/Viewport/Close | root/react or /components/popover | named matching Props exports |
| TooltipProvider/Group/Tooltip/Trigger/Content | /components/tooltip | Matching Props exports; **not root/react**; [standalone/shared composition](./tooltip.md) |
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
| Dropdown content | sideOffset4; shared anchored 580ms settle/160ms fade/140ms exit; existing 350/35 magnetic item spring; item variant default or destructive, inset optional |
| Dropdown checkbox | checked supported; inset optional; indicator wrapper supplies check icon |
| Dropdown label/subtrigger | inset optional |
| Dropdown submenu content | Same anchored surface recipe; independent existing magnetic boundary; controlled/default-open subroot and positioning options |
| PopoverContent | align center; sideOffset4; width72 utility; shared .97/5px anchored entrance, .98/half-offset exit; explicit Motion props opt out; className/position/collision/focus callbacks |
| PopoverViewport | Optional plain native-div scroll body, fadeEdges true, scrollbars hover/scroll/always/hidden, orientation vertical/horizontal/both; ref reaches the viewport, not frame |
| TooltipProvider/TooltipGroup | delayDuration450, skipDelayDuration450, closeDelay70; motion grow, durationMultiplier1, arrow true, variant neutral; group additionally shares one morphing bubble |
| Tooltip | Local/controlled visibility; provider presentation overrides; followCursor false or true/x/y; overflowOnly false |
| TooltipContent | Optional title/description/shortcut or children/full-trigger fallback; local presentation overrides, positioning/collision, optional container; collisionPadding8, viewport-constrained260px max and wrapping; optional arrow/owned portal |
| CollapsibleContent | keepRendered false; transition duration0.35s/easeInOut |
| SidebarProvider | defaultOpen true; optional open/onOpenChange; desktop widths16rem/icon3rem |
| Sidebar | side left, variant sidebar, collapsible offcanvas, animateOnHover true; spring350/damping35 |
| Sidebar mobile | below768px; width18rem, independent mobile open state |
| Sidebar mobile composition (2.5 working addition) | optional `mobileTransition`, `mobileOverlayTransition`, `onMobileCloseAutoFocus`; caller class/style reach the portalled mobile surface; defaults unchanged |
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

Dropdown root/submenu Content add `viewportRef`, `fadeEdges`, `scrollbars`,
`viewportClassName` and `viewportStyle` for their single inner native scroller.
The native Content ref still reaches the outer positioned/dismissable element.
Headers, dividers, icons, checks and shortcuts retain their existing semantic
parts; arbitrary Popover forms do not become menus automatically.

Working-source ContextMenu Content/SubContent now have the same explicit
viewport options plus `orientation` and `scrollTreatment="arc"|"native"`.
The standard default uses one inner viewport; opaque `asChild` content retains
native scrolling unless it composes `ContextMenuViewport` directly inside its
semantic host. Arc content inherits managed-overlay ownership; the native
branch preserves the old manual contract. These additions are not retroactive
2.4.0 package features. See [Context Menu scrolling](./context-menu.md#scroll-treatment-and-custom-content)
for native refs, custom-host forwarding and retained-original comparison.

[Feature guides](./index.md) explain state/authority/lifecycle. The
[design-system configuration](../../design-system/configuration.md) owns tokens,
themes and ordinary icon triggers.
