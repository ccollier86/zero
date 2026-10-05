---
id: zero.frontend.app-shell.index
type: index
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell
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

# Application Shell

[Frontend index](../index.md) · [Documentation index](../../index.md)

AppShell composes a token-based application frame: navigation, optional workspace
switching, user menu, breadcrumbs, header actions and content. It does not log in,
select a Guardian tenant, grant permissions or fetch navigation items itself.
Those responsibilities belong to the app's scoped hooks and server services.

## Choose A Guide

- [Presets and composition](./presets.md) chooses the outer layout and demonstrates
  a complete small shell.
- [Navigation and menus](./navigation.md) declares groups, active links, nested
  items, icons and contextual actions.
- [Workspace switching](./workspaces.md) integrates an authority-owned selection
  and the pending/error/focus contract.
- [Header and account](./header-and-account.md) places breadcrumbs, theme controls,
  action slots and account navigation.
- [Configuration](./configuration.md) lists public props, types and defaults.
- [Roadmap](./roadmap.md) separates proposed shell evolution from current behavior.

Public components and their Props types are AppShell, AppShellHeader,
AppShellSidebar and AppShellBreadcrumbs. Import them from
`@zero/framework/components/app-shell`, the root package or
`@zero/framework/react`. AppShell* declaration types share these entrances.
Private icon/link/workspace helper functions are not supported package APIs.

## Building Principles

The inspected implementation favors small declarative descriptors and explicit
slots over one app-specific dashboard. Reuse the supplied frame, but keep data
and authority in their owning hooks. A workspace label is presentation, not proof
that its database or permissions are active. Hidden or disabled navigation never
replaces [Guardian authorization](../../backend/guardian/index.md).

## Related Guides And Next Steps

- [Runtime providers](../runtime/index.md) installs the client/theme infrastructure.
- [Guardian workspace hooks](../guardian/index.md) supplies authorized organizations.
- [Data controls](../data-controls/index.md) provides compact control planes inside
  the content region.
