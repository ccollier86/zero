---
id: zero.frontend.components.configuration
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: component-configuration
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

# Configure Components At Their Owning Boundary

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

Reusable component configuration consists of typed React props, inherited native
or headless-control props, and the required provider context. It is not an
independent environment/config-file discovery layer. A documentation folder name
does not create a package import; use each guide's actual public entrance.

## Choose The Canonical Reference

| Configuration responsibility | Canonical reference |
| --- | --- |
| Native/button/choice/date/layout/chart/command/toast props | [Primitive configuration](./primitives/configuration.md). |
| Menu/popover/tooltip/sidebar/collapsible/radial providers and state | [Overlay configuration](./overlays/configuration.md). |
| Public Hero/navigation/content/code collection descriptors | [Public-page configuration](./public-pages/configuration.md). |
| String source/replay/effect timing and callbacks | [Text configuration](./text/configuration.md). |
| Browser-held secret masking/copy and QR matrix props | [Sensitive display](./sensitive-display.md). |
| Structured JSON/text drafts, validation and local commit handles | [JSON editor](./json-editor.md). |
| Bottom anchoring refs/spring/context | [Scroll anchoring](./scroll-anchoring.md). |
| Outer app frame/workspace/menu/header descriptors | [AppShell configuration](../app-shell/configuration.md). |
| Theme, semantic tokens, icons and style building | [Design-system configuration](../design-system/configuration.md). |

Domain controls follow their own configuration references:
[Guardian](../guardian/index.md), [Storage](../storage/configuration.md),
[Data Studio](../data-studio/configuration.md), [data controls](../data-controls/configuration.md),
[forms](../forms/configuration.md), [notifications](../notifications/configuration.md)
and [rooms](../rooms/configuration.md). These connect presentation to live service
capabilities rather than creating a second authorization system in component props.

## Controlled State, Commands And Security

Use value/open/ID with its change callback when the parent owns the current value.
A default prop is initial uncontrolled state, not a live reconfiguration channel.
Callback types and await semantics belong to each component's contract: a native
onClick is not an accepted-write runner simply because it returns a Promise.

Visibility/disabled/capability props narrow UI. They never grant a missing server
permission, choose an untrusted database, or make a browser-held secret inaccessible.
Use the integrated client/services for transport and Guardian/Fabric for actual
authority. Retire or key organization/record-specific UI when its owning identity
changes; generic presentation components cannot infer an unknown row ID.

Keep token/focus/label/error behavior when customizing classes. Existing
source-copy CLI customization remains an explicit app-owned path, not an implicit
modification of every installed Zero component.

## Related Guides And Next Steps

- [Runtime providers](../runtime/index.md) defines common provider ownership.
- [SDK](../sdk/index.md) owns authenticated scoped server data.
- [Component conventions](../design-system/component-conventions.md) keeps styles coherent.
