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
applies_to: ["2.4.3 candidate with collapsed-sidebar tooltip corrections; package qualification pending"]
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

This declaration fragment supplies presentation and callbacks only. AppShell
anchors use ordinary browser links; they do not substitute the file router's
Link/prefetch behavior. A leaf without href becomes a button. disabled leaves
prevent activation; disabled descriptors do not revoke access to a server API.

## Menu And Icon Types

AppShellMenuItem is a union: a separator, a label, or an actionable item. Actionable
items accept id, label, icon, href, shortcut, destructive, disabled and onSelect.
The menu invokes onSelect and then navigates to href when supplied; it does not
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
