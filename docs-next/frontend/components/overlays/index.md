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

# Menus, Popovers, Tooltips And Sidebar Controls

[Components index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use these families for local interaction/navigation, not new service or auth
boundaries. Root components own context; trigger/content pairs must be composed
under the matching root. Menus select actions, popovers contain small interactive
panels, tooltips add nonessential descriptions, and collapsibles disclose content.

## Feature Guides

- [Dropdown menus](./dropdown-menu.md): ordinary/check/radio items, groups and submenus.
- [Popovers](./popover.md): controlled inline panels with dismissal/focus callbacks.
- [Tooltips](./tooltip.md): the public Radix family, separate from internal shared sidebar tooltips.
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

## Authority And Lifecycle

Controlled open state describes local UI, not current permissions. Filter
available commands through the app's authority projection, then send mutations
through authorized services and wait for accepted writes. None of these generic
menus automatically adds confirmation, row pending state, retry or backend
refresh. Their callbacks remain app-owned.

Portalled content inherits the relevant React context but is not necessarily
inside the trigger's DOM parent. Use provided className/props and intended
tokens; verify focus, dismissal and responsive behavior in the actual app.
These source-observed drafts do not claim comprehensive screen-reader/mobile or
browser animation qualification.
