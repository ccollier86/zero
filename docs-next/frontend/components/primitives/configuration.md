---
id: zero.frontend.components.primitives.configuration
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: primitive-configuration
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

# Primitive Configuration And Import Boundaries

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Primitive settings are native/headless props evaluated at render time. They are
not config-file/env/Doctor settings. Components with controlled value/open state
use the parent's render value; defaultValue/defaultOpen initializes a local
headless control only when that underlying contract supports it.

The UI wildcard modules are imported as
`@zero/framework/components/ui/<source-name>`, not
`@zero/framework/components/primitives/<documentation-name>`.
Documentation grouping does not create package export paths. Checkbox, RadioGroup
and Progress also have named component subpaths outside /ui, documented in their
feature pages. Native wrappers preserve relevant accessibility/form attributes;
custom organizers have their explicitly listed Props interfaces.

| Responsibility | Owner |
| --- | --- |
| Joined action controls, addons and separate single/multiple selection | [Button Group configuration](./button-group.md#public-parts-and-configuration); added in 2.4.0. |
| Theme/tokens/style output | [Design system](../../design-system/index.md). |
| Persisted field validation/submission | [Forms](../../forms/index.md) and server services. |
| Query/search/sort/page/action state | [DataTable](../../data-controls/data-table/index.md). |
| Scrolling/layout/details/bottom-bar slots | [Local layout primitives](./list-detail.md). |
| Server authority and tenant ownership | [Guardian](../../../backend/guardian/index.md). |
| Notification persistence | [Notification service](../../notifications/index.md). |

Do not infer await/deduplication/invalidation from an onClick callback. Standard
native/headless callbacks are UI notifications. Higher-level controls explicitly
own accepted command semantics. Style customization must preserve readable focus,
error/disabled state, labels and contrast; a className is not a security option.

## Related Guides And Next Steps

- [Input props](./inputs.md) supplies native control/default behavior.
- [Choice props](./choices.md) supplies headless value/selection contracts.
- [Design conventions](../../design-system/component-conventions.md) owns customization.
