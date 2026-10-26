---
id: zero.frontend.app-shell.navigation
type: reference
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-navigation
maturity: supported
applies_to: ["2.6.0 builds with AppShell linkComponent"]
modes: [browser, SSR, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.3"
  commit: "8327e4498f52b12b43759bbc4618973601191039"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Navigation, Icons And Menus

[AppShell index](./index.md) · [Documentation index](../../index.md)

nav and secondaryNav are arrays of AppShellNavGroup. Each group requires items;
id, label and hideWhenCollapsed are optional. The generated sidebar renders both
sets through the same controls, with secondary navigation receiving muted styling.
The app filters descriptors using its live capabilities before rendering them.

AppShellNavItem requires label and optionally accepts id, href, icon, variant,
active, defaultOpen, disabled, badge, tooltip, children, actions and onSelect.
variant is default or action; action adds a dashed action-like appearance.

The generated sidebar uses `item.tooltip ?? item.label` for the collapsed
desktop hint. Set `tooltip` to a descriptive string when the visible label is
abbreviated. The control's accessible `aria-label` remains `item.label`; a custom
tooltip changes the hover hint, not that control name.
No new application configuration or tooltip provider is required. Hints appear
on pointer hover only and use Zero's [public Radix tooltip](../components/overlays/tooltip.md)
for portal placement, viewport collisions and long-label wrapping. Decorative
sidebar hover highlighting is independent of tooltip interaction.
Keyboard focus alone does not open a sidebar hint. Clicking the control
dismisses it until the pointer leaves and hovers again; the accessible label
still identifies the control for keyboard and assistive-technology users.

The brand/workspace and account controls also receive generated labels from
their configured names. A custom sidebar slot is different: its controls are
app-owned and need explicit `SidebarMenuButton tooltip` values and accessible
names. See [collapsed menu labels](../components/overlays/sidebar-menu.md#collapsed-labels-and-placement)
for lower-level positioning and custom-content overrides.

Active appearance is true when active is truthy, a child is active, or currentPath
matches href exactly or begins with href plus '/'. It is not a full route matcher:
provide a normalized pathname, not a URL containing search/hash. active=false
does not override a matching pathname. Nested parents use defaultOpen when
provided, otherwise their initial active state; later pathname changes do not
turn that uncontrolled initial value into controlled expansion.

```tsx
import type { AppShellNavGroup } from '@zero/framework/components/app-shell';

export const navigation: AppShellNavGroup[] = [{
  id: 'workspace', label: 'Workspace',
  items: [{
    label: 'Projects', tooltip: 'Browse projects', href: '/app/projects',
    children: [
      { label: 'All projects', href: '/app/projects' },
      { label: 'Archived', href: '/app/projects/archived' },
    ],
    actions: [
      { label: 'New project', onSelect: () => { /* open app-owned dialog */ } },
    ],
  }],
}];
```

This declaration fragment supplies presentation and callbacks only. A leaf
without href becomes a button. Disabled leaves prevent activation; disabled
descriptors do not revoke access to a server API.

## Persistent Client Navigation

In a managed Zero application, pass the existing router `Link` once at the
shared shell boundary:

```tsx
import type { ReactNode } from 'react';
import { AppShell } from '@zero/framework/components/app-shell';
import { Link, usePathname } from '@zero/framework/react';

export function StaffShell({ children }: { children: ReactNode }) {
  return <AppShell linkComponent={Link} currentPath={usePathname()}
    brand={{ name: 'Workspace', href: '/app' }} nav={navigation}>
    {children}
  </AppShell>;
}
```

Keep that shell in a common layout with one unkeyed root `AppProvider`. The
generated hydration runtime already provides the router; standalone compositions
need `RouterProvider`. Do not key the provider/layout by pathname or mount a
second collector per route. Internal links then preserve shared provider,
collector and layout identity while the new route module resolves.

`linkComponent` covers brand, leaf/nested sidebar entries, breadcrumbs and
built-in account/workspace/action menus, including portaled menus. It is an
anchor-compatible component receiving `AppShellLinkProps`: forward `href`, DOM
attributes, events, children and the real anchor ref. Zero `Link` preserves
modified/middle clicks, target/new-tab links, downloads and external destinations.
Ordinary local activation uses the existing router and unsaved-change guards.

Omission intentionally keeps real native anchors for standalone/other-router
compatibility. Custom sidebar/footer/header content is app-owned: use `Link`
there explicitly. Do not combine `router.push()` with an unprevented native
`href`, invent a MouseEvent argument for the parameterless `onSelect`, or await
an action callback as if it were a navigation admission guard. Use the shared
form/save navigation guards instead. An href-less menu item remains an action.

Qualify actual document-request counts and shared shell identity, not only the
eventual page text. A hard refresh/new tab is still a new document and performs
normal session and required-delivery admission. Unknown/server-only routes keep
the router's documented document fallback; this adapter does not add SSR loaders,
server actions or replace the underlying router.

## Menu And Icon Types

AppShellMenuItem is a union: a separator, a label, or an actionable item. Actionable
items accept id, label, icon, href, shortcut, destructive, disabled and onSelect.
The menu invokes onSelect and activates a real composed anchor when href is supplied; it does not
await asynchronous callbacks or run table-style confirmations/invalidation.
A displayed shortcut is a label, not an installed hotkey handler.

AppShellIcon accepts a Zero registry name, a Zero animated icon component, or a
React component accepting className/size. Brand/workspace logo takes precedence
over icon; initials are the final fallback. Use [design-system icons](../design-system/icons.md)
for the actual name set and attribution rather than guessing identifiers.

## Related Guides And Next Steps

- [Workspaces](./workspaces.md) applies pending state to workspace menu actions.
- [Header and account](./header-and-account.md) reuses menu descriptors for accounts.
- [Router navigation](../router/navigation.md) owns enhanced Link semantics.
