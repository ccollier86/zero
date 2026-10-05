---
id: zero.frontend.app-shell.configuration
type: reference
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-configuration
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

# AppShell Configuration

[AppShell index](./index.md) · [Documentation index](../../index.md)

All settings are React props/descriptors evaluated at render time, not environment
variables, backend initialization settings or automatically discovered Doctor
configuration. Public types are exported by
`@zero/framework/components/app-shell`, the root and React barrels.

| Outer prop | Contract/default |
| --- | --- |
| children | Required ReactNode; application content. |
| preset | AppShellPreset; dashboard default; [preset differences](./presets.md). |
| brand | AppShellBrand: name required; subtitle/icon/logo/href optional. |
| nav / secondaryNav | AppShellNavGroup arrays; empty generated navigation by default. |
| workspaces | AppShellWorkspaceConfig; omitted shows brand instead. |
| user / userMenu | AppShellUser or null; optional AppShellMenuItem overrides. |
| breadcrumbs / actions | Breadcrumb array/false and ReactNode header shortcuts. |
| header | AppShellHeaderConfig or false; object overrides header shortcuts. |
| sidebar | ReactNode or false; [preset-dependent interpretation](./presets.md). |
| footer | ReactNode before generated account menu. |
| currentPath | Caller-owned pathname for active navigation appearance. |
| className / contentClassName | Outer frame/content classes merged with defaults. |
| contentMode | workspace or document. Dashboard/auth-dashboard/custom/simple-sidebar default workspace; topbar/minimal default document. |
| defaultSidebarOpen | Initial uncontrolled SidebarProvider open state. |
| sidebarOpen / onSidebarOpenChange | Controlled sidebar open/request pair. |

The full nested public declarations are AppShellIcon, AppShellBrand,
AppShellBreadcrumb, AppShellWorkspace, AppShellWorkspaceConfig, AppShellMenuItem,
AppShellNavItem, AppShellNavGroup, AppShellUser, AppShellHeaderConfig and
AppShellThemeToggleConfig. Exact field tables and precedence live in
[navigation](./navigation.md), [workspace selection](./workspaces.md) and
[header/account](./header-and-account.md), rather than duplicated schema copies.

Direct AppShellSidebarProps exposes brand, nav, secondaryNav, workspaces, user,
userMenu, footer, currentPath and customSidebar. It requires SidebarProvider.
A truthy customSidebar replaces its generated internal content. Direct
AppShellBreadcrumbsProps exposes items/className. Direct AppShellHeaderProps
omits hide and otherwise follows the header configuration.

## Workspace Height And Document Flow

workspace uses a bounded small-viewport-height frame with a zero-minimum
flex/grid content chain. The shell's header/sidebar remain outside the content
panes; long master/detail screens scroll within their own regions rather than
pushing the action bar below the page. Preserve `min-h-0 min-w-0 flex-1` in any
extra page wrappers and let the chosen data-control component own its scroll
regions. See [MasterDetailPage](../data-controls/master-detail.md) and
[ListDetailLayout](../components/primitives/list-detail.md) for complete examples.

document preserves natural page scrolling for landing pages, long articles and
traditional vertically growing content. topbar and minimal retain that default;
other presets choose workspace. Select contentMode explicitly when changing a
dashboard to a document page or a minimal/topbar frame to a data workspace.
This working-source API is additive, but the dashboard default now establishes a
bounded workspace: a long document in that preset should opt into document mode.
Styles that replace the fixed frame or zero-minimum content chain also replace
that layout guarantee.

## Lifecycle And Authority

Callbacks are UI commands, not awaited server transaction contracts. The shell
neither loads lists nor invents pending/error state; its data source supplies
those signals. Replacing props updates presentation, but uncontrolled sidebar and
nested expansion defaults are initial values. Controlled values remain owned by
the parent. Do not infer application or cross-tenant access from these descriptors.

## Related Guides And Next Steps

- [Workspaces](./workspaces.md) gives the pending/committed-selection contract.
- [Presets](./presets.md) identifies provider/layout differences.
- [Guardian](../../backend/guardian/index.md) supplies real authorization rules.
