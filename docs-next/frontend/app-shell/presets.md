---
id: zero.frontend.app-shell.presets
type: how-to
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-layout
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

# Choose An Application Layout

[AppShell index](./index.md) · [Documentation index](../../index.md)

AppShell requires children. Its default preset is dashboard. No preset performs
an authentication check; auth-dashboard is a layout choice, not a security gate.
Use route access and [Guardian gates](../guardian/index.md) independently.

```tsx
import { AppShell } from '@zero/framework/components/app-shell';

export function DashboardFrame({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      brand={{ name: 'Example', icon: 'layers' }}
      nav={[{ label: 'Workspace', items: [
        { label: 'Overview', href: '/app', icon: 'compass' },
      ] }]}
      currentPath="/app"
      header={{ title: 'Overview', themeToggle: true }}
    >
      {children}
    </AppShell>
  );
}
```

This is a component fragment mounted beneath the app's normal providers. The
literal currentPath is illustrative: derive it from your router in a real page.
Use a registry icon name declared by the installed Zero version, or pass an icon
component instead.

| Preset | Composition |
| --- | --- |
| dashboard | Generated collapsible sidebar, inset header and content. |
| auth-dashboard | Same outer composition; the app owns identity-aware content. |
| custom | Same sidebar provider/inset frame; a truthy sidebar node replaces generated sidebar content. |
| simple-sidebar | App-owned sidebar node in a responsive fixed-width aside; no generated navigation. |
| topbar | Header and content without sidebar context or trigger. |
| minimal | Content-only main; shell navigation/header/account descriptors are unused. |

For dashboard/auth-dashboard/custom, sidebar=false removes the sidebar. A custom
sidebar node is consumed as replacement only by custom; dashboard continues to
use declarative generated navigation. simple-sidebar renders only the supplied
sidebar node, not brand/nav/workspaces automatically.

For provider-based presets, defaultSidebarOpen is the initial uncontrolled state;
sidebarOpen and onSidebarOpenChange support controlled state. Mobile behavior
belongs to [Sidebar](../components/overlays/index.md). className styles the outer
frame; contentClassName styles the content region. They do not bypass design tokens.

header=false and header.hide disable the outer header in every header-bearing
preset. The focused source correction makes these options consistent across
dashboard, auth-dashboard, custom, topbar and simple-sidebar.
The direct AppShellHeader component has no hide prop: omit it at the caller.

Dashboard/auth-dashboard/custom/simple-sidebar default to a bounded workspace
content chain; topbar/minimal keep natural document flow. Use contentMode to
choose explicitly. Long data-control panes need workspace mode; article-like
pages in a dashboard can select document mode. See
[configuration and height chains](./configuration.md#workspace-height-and-document-flow).

## Verification

Render every selected preset with synthetic content. Verify keyboard access,
sidebar collapse/mobile layout and that omitted slots leave usable content.
Test your actual auth route separately; a shell rendering does not establish it.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists the complete outer prop contract.
- [Navigation](./navigation.md) supplies generated-sidebar descriptors.
- [Header and account](./header-and-account.md) explains slot precedence.
