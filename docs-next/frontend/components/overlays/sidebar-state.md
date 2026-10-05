---
id: zero.frontend.overlays.sidebar-state
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: sidebar-state
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

# Sidebar Provider State, Cookies And Shortcuts

[Overlays index](./index.md) · [Documentation index](../../../index.md)

SidebarProvider supports defaultOpen=true or controlled open/onOpenChange.
useSidebar is a strict-context hook and exposes state(expanded/collapsed),
open/setOpen, openMobile/setOpenMobile, isMobile and toggleSidebar.

Desktop open uses controlled value when supplied, otherwise internal state.
Mobile open is a separate local state, initially false. Toggle chooses the
mobile state below768px and desktop state otherwise. Controlled desktop open
does not replace mobile sheet state.

## Persistence And Keyboard

Desktop setOpen writes sidebar_state cookie on path / with max-age604800
seconds (seven days). Provider does **not** automatically read that cookie to
derive defaultOpen; app/server composition may deliberately supply the initial
value. Cookie is a UI preference, not a session token or permission.

Provider registers Ctrl+B / Cmd+B toggle and removes its listener on cleanup.
It prevents the browser shortcut when handling it. Multiple unrelated providers
can each own listeners; mount one deliberate layout provider rather than using
providers as wrappers on every menu item.

Complete controlled-state example:

```tsx
import { useState } from "react";
import { SidebarProvider, Sidebar, SidebarContent,
  SidebarTrigger, SidebarInset } from "@zero/framework/react";

export function ControlledNavigation() {
  const [open, setOpen] = useState(true);
  return <SidebarProvider open={open} onOpenChange={setOpen}>
    <Sidebar><SidebarContent>Navigation</SidebarContent></Sidebar>
    <SidebarInset><SidebarTrigger /> Content</SidebarInset>
  </SidebarProvider>;
}
```

Provider sets CSS variables --sidebar-width16rem and --sidebar-width-icon3rem;
caller style spreads afterward. Mobile sheet currently supplies its18rem width.
Do not infer an env/store setting or automatic persisted organization selection.

[Sidebar](./sidebar.md) owns layout, [menu](./sidebar-menu.md) owns entries and
[AppShell workspace](../../app-shell/index.md) owns its higher-level authority
projection. Test cookie/shortcut behavior deliberately in the target browser.
