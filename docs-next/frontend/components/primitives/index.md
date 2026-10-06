---
id: zero.frontend.components.primitives.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: ui-primitives
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Interface Primitives

[Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Primitives apply Zero's shared styling to native elements and upstream headless
controls. They own rendering/local interaction. Choose a domain component when
you need accepted mutations, authenticated transport, tenant selection or a
complete control plane.

## Feature Guides

- [Buttons and text inputs](./inputs.md): native props, slots and form behavior.
- [Button groups](./button-group.md): joined actions, addons, split controls and separate single/multiple selection.
- [Choice controls](./choices.md): Select, Combobox, Checkbox and RadioGroup.
- [Tags, progress and validation](./tags-and-validation.md): controlled lists,
  range-correct progress and caller-computed rule feedback.
- [Dates and time](./dates-and-time.md): Date/DateRange/HH:mm values and calendar policy.
- [Inline text editing](./inline-editing.md): revision-aware geometry-preserving editing.
- [Surfaces and identity](./surfaces.md): cards, badges, avatars, separators and skeletons.
- [List/detail control planes](./list-detail.md): layout, detail region and compact bottom actions.
- [Resizable panels](./resizable.md): established library sizing with Zero tokens and keyboard support.
- [Tables and page links](./tables-and-pagination.md): semantic markup without an implied query engine.
- [Breadcrumbs](./breadcrumbs.md): linked ancestors and current-page labels.
- [Charts and statistics](./charts.md): config/series styling and metric presentation.
- [Command palettes](./command.md): cmdk composition and modal command lists.
- [Scroll regions](./scroll-area.md): bounded scrolling distinct from bottom anchoring.
- [Toasts](./toasts.md): one themed host and caller-owned safe notifications.
- [Configuration](./configuration.md): public paths, providers and prop precedence.
- [Roadmap](./roadmap.md): future convenience ideas and separate verification work.

The `@zero/framework/components/ui/*` package wildcard exposes the corresponding
source filename (without extension), excluding test/spec modules. Components
also present in the root/React barrel are usable there; helper/type exports are
not assumed to be re-exported automatically. Each guide uses a verified import.

## Related Guides And Next Steps

- [Forms](../../forms/index.md) composes these fields using schema metadata.
- [DataTable](../../data-controls/data-table/index.md) supplies full query controls.
- [Design-system conventions](../../design-system/component-conventions.md) supplies
  semantic styling and customization boundaries.
