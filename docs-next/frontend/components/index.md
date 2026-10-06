---
id: zero.frontend.components.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: component-families
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

# Reusable Components

[Frontend index](../index.md) · [Documentation index](../../index.md)

Use the smallest component that owns the interaction you need. Domain organisms
have their own manuals; primitives do not perform authentication, queries or
persistence simply because they are exported by Zero.

- [Primitives](./primitives/index.md) covers inputs, selection, dates, surfaces,
  semantic tables, charts and compact list/detail layout.
- [Sensitive display](./sensitive-display.md) covers browser-held secret masking
  and QR presentation without claiming security from visual hiding.
- [JSON editor](./json-editor.md) covers structured JSON/text drafts and explicit
  local admission before a caller-owned server save.
- [Cascader](./cascader.md) combines nested selection, capped checkboxes,
  complete-path search, async levels, pinned commands and external chips.
- [Text](./text/index.md) covers static, animated and streamed strings with
  explicit source ownership.
- [Scroll anchoring](./scroll-anchoring.md) follows transcript growth without
  forcing readers away from earlier content.
- [Overlays](./overlays/index.md) covers menu, popover, tooltip, collapsible,
  sidebar and radial composition.
- [Public pages](./public-pages/index.md) covers navigation, Hero/content sections,
  code examples and expressive content collections.
- [Configuration](./configuration.md) routes prop/provider settings to their
  canonical owner without duplicating domain configuration.
- [Roadmap](./roadmap.md) groups known reusable UI/editor/plugin plans and links
  the responsible family roadmaps.

These are source-observed first drafts, not a claim that every component is
already package/browser/device qualified.

## Related Guides And Next Steps

- [Design system](../design-system/index.md) owns token, theme and icon conventions.
- [Data controls](../data-controls/index.md) owns table queries/editing/actions.
- [AppShell](../app-shell/index.md) provides the application frame.
