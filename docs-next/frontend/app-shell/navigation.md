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
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
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
    label: 'Projects', href: '/app/projects',
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
