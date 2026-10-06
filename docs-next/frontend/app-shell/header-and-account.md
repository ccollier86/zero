---
id: zero.frontend.app-shell.header-and-account
type: reference
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-header-account
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

# Header, Breadcrumbs And Account Menu

[AppShell index](./index.md) · [Documentation index](../../index.md)

The outer shell accepts breadcrumbs and actions as shortcuts. A header object
spreads after those values, so header.breadcrumbs/header.actions take precedence.
header=false hides the outer header; hide belongs to the outer configuration,
not the direct AppShellHeaderProps contract.

AppShellHeader supports showSidebarTrigger (true by default), breadcrumbs, title,
subtitle, leading, content, actions, themeToggle, trailing and className. Set
showSidebarTrigger=false when rendering it outside SidebarProvider. topbar and
simple-sidebar already suppress the sidebar trigger. leading appears before the
primary content; actions, theme control and trailing occupy the right region.

content takes precedence over breadcrumbs/title/subtitle when not nullish.
Otherwise a truthy breadcrumbs value selects the breadcrumb component; otherwise
title/subtitle render. An empty breadcrumbs array is truthy but the breadcrumb
component renders nothing, so omit it or use false when a title should appear.

```tsx
import { AppShell } from '@zero/framework/components/app-shell';

export function AccountFrame({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      breadcrumbs={[{ label: 'Workspace', href: '/app' }, { label: 'Settings' }]}
      header={{ themeToggle: true }}
      user={{ name: 'Example Operator', accountHref: '/app/account' }}
    >
      {children}
    </AppShell>
  );
}
```

This fragment needs the normal theme provider; a theme button cannot configure
server authentication. themeToggle true uses ghost/default-size, light/dark and
ltr defaults. An object merges those defaults with AppShellThemeToggleConfig
(ThemeTogglerButtonProps without children). Omitted/false means no theme control.
See [themes](../design-system/index.md) for provider and transition behavior.

## Breadcrumb And User Descriptors

AppShellBreadcrumbs accepts items (array or false) and className. Each breadcrumb
requires label, optionally href/icon. Empty/false returns nothing. The last or
unlinked item is a page label; preceding linked items are ordinary anchors.
Ancestors/separators are visually hidden below the md breakpoint.

AppShellUser requires name, optionally email, avatar, fallback, accountHref,
notificationsHref and onLogout. Avatar fallback uses caller fallback or initials.
Omitted/null user means no account menu; it does not sign the client out.

The generated footer account button has a collapsed-desktop tooltip and
accessible label derived from `user.name`. Likewise, when the sidebar displays
the brand instead of a workspace switcher, its hint is derived from `brand.name`.
Both use the same [viewport-aware public tooltip](../components/overlays/tooltip.md)
as navigation items. Pointer hover shows the hint; keyboard focus alone does
not. Clicking the control/opening its dropdown suppresses the hint until the
pointer leaves and hovers again, and expanding the sidebar dismisses it. The
actual button and its ref remain
stable across the collapsed/expanded transition.

Without userMenu, accountHref creates Account, notificationsHref creates
Notifications, and onLogout creates Log out. No configured actions produces a
disabled Settings item. Supplying userMenu replaces that generated action list,
including an explicit empty array. onLogout is a caller-owned command; call the
[official authentication client](../guardian/index.md), not an invented local
session reset. footer renders before the user menu in the generated sidebar.

## Related Guides And Next Steps

- [Navigation and menus](./navigation.md) defines the shared menu union.
- [Configuration](./configuration.md) locates every public type/prop.
- [Notifications](../notifications/index.md) provides the actual inbox components.
