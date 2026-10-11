---
id: zero.frontend.overlays.index
type: index
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: index
maturity: supported
applies_to: ["2.6.0 working source; organized Popover/shared mechanisms with retained compatibility paths"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Menus, Popovers, Tooltips And Sidebar Controls

[Components index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use these families for local interaction/navigation, not new service or auth
boundaries. Root components own context; trigger/content pairs must be composed
under the matching root. Menus select actions, popovers contain small interactive
panels, tooltips add nonessential descriptions, and collapsibles disclose content.

## Feature Guides

- [Dropdown menus](./dropdown-menu.md): ordinary/check/radio items, groups and submenus.
- [Context menus](./context-menu.md): conventional right-click/keyboard/touch actions, nested commands, icons and trailing choice indicators.
- [Popovers](./popover.md): trigger-origin anchored panels with native placement/focus and decorated native viewports.
- [Tooltips](./tooltip.md): public/provider composition, Grow motion, arrow and placement options, and shared grouped-trigger behavior.
- [Collapsibles](./collapsible.md): disclosure and optional retained content.
- [Sidebar](./sidebar.md): navigation structure and responsive presentation.
- [Sidebar state](./sidebar-state.md): provider/control/mobile/cookie/shortcut contract.
- [Sidebar menu](./sidebar-menu.md): buttons/actions/badges/submenus/loading.
- [Radial menu](./radial-menu.md): context-menu selection and geometry.
- [Configuration](./configuration.md): public imports/defaults and inherited types.
- [Roadmap](./roadmap.md): deliberate future work.

[AppShell](../../app-shell/index.md) is the high-level layout alternative;
[modals](../../modals/index.md) own deliberate confirmations.
[Design tokens](../../design-system/index.md) supply presentation vocabulary.
[Source organization](../source-organization.md) distinguishes canonical Popover
and shared overlay mechanisms from their retained public/import paths. Dropdown,
Tooltip and Highlight keep their existing runtime owners; ContextMenu retains
its separate pointer-anchored presence behavior.

## Authority And Lifecycle

Controlled open state describes local UI, not current permissions. Filter
available commands through the app's authority projection, then send mutations
through authorized services and wait for accepted writes. None of these generic
menus automatically adds confirmation, row pending state, retry or backend
refresh. Their callbacks remain app-owned.

Portalled content inherits the relevant React context but is not necessarily
inside the trigger's DOM parent. Use provided className/props and intended
tokens; verify focus, dismissal and responsive behavior in the actual app.
Focused synthetic browser tests qualify branch ownership, theme projection,
scroll decoration and existing magnetic behavior. They do not replace
representative-app visual, contrast, screen-reader or mobile qualification.
