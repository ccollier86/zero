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

Button defaults isActive=false/asChild=false; isActive changes presentation, not
route matching or authority. Tooltip can be string or the internal content prop
shape; it appears only on collapsed nonmobile navigation and is immediately
retired when that context changes/unmounts. You do not mount the private shared
tooltip provider yourself.

Complete nested navigation example:

```tsx
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "@zero/framework/react";

export function ProjectsNavigation() {
  return <SidebarProvider><Sidebar>
    <SidebarContent><SidebarMenu><SidebarMenuItem>
      <SidebarMenuButton isActive><span>Projects</span></SidebarMenuButton>
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
