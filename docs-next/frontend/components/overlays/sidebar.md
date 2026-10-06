---
id: zero.frontend.overlays.sidebar
type: architecture
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: sidebar
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

# Build A Sidebar Without Rebuilding AppShell

[Overlays index](./index.md) · [Documentation index](../../../index.md)

For a complete standard application layout prefer [AppShell](../../app-shell/index.md).
Use the public Sidebar family when the app needs a custom navigation structure.
All Sidebar components/useSidebar are exported from root/react and
/components/sidebar; provider context is required.

Complete custom layout:

```tsx
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarFooter, SidebarInset, SidebarTrigger, SidebarGroup,
  SidebarGroupLabel, SidebarGroupContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton } from "@zero/framework/react";

export function NavigationLayout() {
  return <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>Example</SidebarHeader>
      <SidebarContent><SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton tooltip="Overview"><span>Overview</span></SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarGroupContent>
      </SidebarGroup></SidebarContent>
      <SidebarFooter>Account</SidebarFooter>
    </Sidebar>
    <SidebarInset><header><SidebarTrigger /></header><main>Content</main></SidebarInset>
  </SidebarProvider>;
}
```

This is a local UI example; no router/client/user authority is initialized.

## Presentation Branches

Sidebar default side=left, variant=sidebar and collapsible=offcanvas.
variant can be floating/inset. collapsible can be icon/none; none stays a
noncollapsing content panel. Desktop collapsed icon width is3rem; normal width16rem.
On a viewport below768px, collapsible sidebars use an independent sheet with
width18rem and internal accessible title/description. Menu tooltips are disabled
for mobile and expanded desktop states.

SidebarInput/Separator/Header/Footer/Content and Group/GroupLabel/GroupAction/
GroupContent organize the navigation. SidebarInset wraps adjoining content.
SidebarTrigger and SidebarRail toggle provider state. Caller className/
containerClassName/style and transition configure local presentation; defaults
and provider state live in [configuration](./configuration.md) /
[sidebar state](./sidebar-state.md).

## Ownership And Verification

State is presentation, not the active Guardian tenant. A workspace selector must
wait for the real authorized scope switch and use the app's committed authority
projection. A collapsed nav never changes backend access.
[Sidebar menu](./sidebar-menu.md) owns active labels/actions/loading. Verify
desktop/mobile, keyboard toggle, focus and responsive sheet behavior in the
actual app; source inspection is not full mobile/device qualification.

## 2.5 Working Mobile Composition Additions

The documentation-reader work extends this same Sidebar rather than building a
second mobile drawer. `className` and `style` reach the actual mobile Sheet
surface, so scoped token aliases and width constraints can follow the portal.
Optional `mobileTransition` and `mobileOverlayTransition` control its content and
overlay Motion transitions without changing desktop Highlight behavior.
`onMobileCloseAutoFocus` receives the native close-focus event; custom triggers
can deliberately restore keyboard focus. These additions preserve default
behavior for existing consumers.

Honor reduced motion on both animated surfaces; changing CSS duration alone
does not control JavaScript-driven effects. Do not steal focus after navigation
to a new page. The [docs reader](../../../plugins/docs/reader.md) demonstrates a
complete custom navigation composition. Its source and installed-browser checks
are recorded separately in the
[2.5 qualification ledger](../../../_work/audits/docs-plugin-qualification.md),
not inferred from the historical 2.1.1 audit metadata above.
