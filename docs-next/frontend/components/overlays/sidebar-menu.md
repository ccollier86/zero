---
id: zero.frontend.overlays.sidebar-menu
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: sidebar-menu
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

# Sidebar Entries, Actions, Submenus And Loading

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Compose SidebarMenu/SidebarMenuItem with SidebarMenuButton under Sidebar and
SidebarProvider. Menu primitives are public root/react or /components/sidebar.
useSidebar must share the same provider as the menu.

| Public control | Responsibility |
| --- | --- |
| SidebarMenu / SidebarMenuItem | list/item semantics and action composition |
| SidebarMenuButton | active/default/outline action or asChild link; size default/sm/lg |
| SidebarMenuAction | adjacent action button; optional showOnHover/asChild |
| SidebarMenuBadge | small count/status beside a menu entry |
| SidebarMenuSkeleton | loading placeholder; optional showIcon |
| SidebarMenuSub / SubItem / SubButton | nested list and link-like subentry; SubButton size md/sm |
| SidebarGroup / Label / Action / Content | labeled navigation section and section action |
| SidebarSeparator / Input | reusable separator and local input |

Button defaults are `isActive: false` and `asChild: false`; active presentation
does not change route matching or authority.

## Collapsed Labels And Placement

`tooltip` accepts a string or the public [TooltipContent](./tooltip.md) prop
shape, including `children`, styling, Motion/layout and collision options. The
hint appears on pointer hover only in collapsed desktop navigation.
It is closed when that state becomes expanded/mobile or the control unmounts.
Escape, pointer activation and leaving the trigger also dismiss the hint.
Clicking the control suppresses its hint until the pointer leaves and hovers
again, so focus retained after navigation does not leave a tooltip onscreen.
Keyboard focus alone does not open these sidebar hints; accessible labels
remain available. Ordinary public tooltips retain their standard focus behavior.

The trigger belongs to the actual button or `asChild` link, so the control's ref,
events and identity remain intact while the sidebar changes state. Disabling
`Sidebar animateOnHover` disables the decorative highlight, not the tooltip.
Sidebar buttons use the same public Radix tooltip as ordinary application
controls; no additional provider is required. Portal placement avoids clipping
inside the scrolling sidebar, and collision handling can flip or shift a label
at the viewport edge.

A string, or an object with string `children`, supplies a default `aria-label`
unless the application has supplied an explicit accessible name. For rich custom
content, supply the accessible control
name yourself. Preferred placement defaults to `side: 'right'`, `align: 'center'`,
`sideOffset: 6`, `collisionPadding: 8` and `hideWhenDetached: true`. For example:
`tooltip={{ children: 'Application settings', collisionPadding: 12 }}` customizes
the content and viewport margin while keeping the other defaults. Tooltips are
noninteractive hints, not a substitute for visible mobile labels or accessible
names.

The generated [AppShell navigation](../../app-shell/navigation.md) supplies its
own labels, including brand/workspace and account controls. Custom sidebar slots
remain app-owned and need explicit tooltip labels on their icon-only controls.

## Nested Entries

Complete nested navigation example:

```tsx
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "@zero/framework/react";

export function ProjectsNavigation() {
  return <SidebarProvider><Sidebar>
    <SidebarContent><SidebarMenu><SidebarMenuItem>
      <SidebarMenuButton
        isActive
        aria-label="Browse projects"
        tooltip={{ children: 'Projects', collisionPadding: 12 }}
      ><span>Projects</span></SidebarMenuButton>
      <SidebarMenuBadge>3</SidebarMenuBadge>
      <SidebarMenuSub><SidebarMenuSubItem>
        <SidebarMenuSubButton href="/projects/current">Current</SidebarMenuSubButton>
      </SidebarMenuSubItem></SidebarMenuSub>
    </SidebarMenuItem></SidebarMenu></SidebarContent>
  </Sidebar></SidebarProvider>;
}
```

Use [Collapsible](./collapsible.md) if the app needs expandable nested groups.
Choose the normal router link through asChild for client navigation; bare href
anchors retain browser navigation semantics.

## Mutation And Loading Boundaries

Badges/skeletons display app-owned data/loading state. MenuSkeleton's width is a
local randomized presentation; it does not fetch anything. Adjacent action
callbacks do not get automatic receipt/pending/retry/confirmation handling.
Use the normal SDK/mutation/action contracts and safe notification after
acceptance. Filter commands by current authority and still enforce on server.

[Sidebar state](./sidebar-state.md) owns responsive/cookie/shortcut behavior,
[configuration](./configuration.md) owns exact defaults and
[design tokens](../../design-system/tokens.md) owns palette.
