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
applies_to: ["2.6.0 working-source routing; each family retains its own review evidence"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Interface Primitives

[Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Primitives apply Zero's shared styling to native elements and upstream headless
controls. They own rendering/local interaction. Choose a domain component when
you need accepted mutations, authenticated transport, tenant selection or a
complete control plane.

## Feature Guides

- [Main UI reference](../../ui-reference.md): shared design tokens, motion/action
  mapping and system overviews; the focused guides below own exact APIs.
- [Buttons and text inputs](./inputs.md): native props, slots and form behavior.
- [Button groups](./button-group.md): joined actions, addons, split controls and separate single/multiple selection.
- [Select](../controls/select.md): native Morph Select, rich slots and actual viewport.
- [Other choice controls](./choices.md): Combobox, Checkbox, RadioGroup and Switch;
  retained Select section routes link to its canonical manual.
- [Tab panels](./tabs.md): controlled local selection through the public animated
  facade; use managed layouts for modal tabs (unreleased facade addition).
- [Tags, progress and validation](./tags-and-validation.md): controlled lists,
  range-correct progress and caller-computed rule feedback.
- [Dates and time](./dates-and-time.md): Date/DateRange/HH:mm values and calendar policy.
- [Inline text editing](./inline-editing.md): revision-aware geometry-preserving editing.
- [Card and ContentCard](../surfaces/card.md): composable parts and managed quick looks.
- [Identity primitives](./surfaces.md): badges, avatars, separators and skeletons;
  retained Card section routes link to its canonical manual.
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
