---
id: zero.frontend.components.index
type: index
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: component-families
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
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
- [Phone input](./phone-input.md) covers flags, searchable countries, canonical
  numbers, shared read-only semantics and generated-form integration.
- [Keyboard hints](./kbd.md) covers native keys/groups, icons, tooltip/input
  compositions and shared compact metrics without registering commands.
- [Avatar group](./avatar-group.md) covers compact rosters, overflow counts,
  optional add actions and explicitly enabled shape-matched status decoration.
- [Settings matrix](./settings-matrix.md) covers one to three choice columns,
  controlled preferences, per-cell save state and capability/scope retirement.
- [Integration settings list](./integration-settings-list.md) covers flat/grouped
  service rows, labeled status, confirmed actions and app-owned target lifetimes.
- [JSON editor](./json-editor.md) covers structured JSON/text drafts and explicit
  local admission before a caller-owned server save.
- [Cascader](./cascader.md) combines nested selection, capped checkboxes,
  complete-path search, async levels, pinned commands and external chips.
- [Signature Pad](./signature-pad.md) covers immutable handwritten ink, pinned
  actions/history, native SVG fields, acknowledged agreements and clause initials.
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

This overview is reviewed against Zero 2.6.0. Each feature guide records its
own evidence; this index does not claim every component/device combination
has independent package and browser qualification.

## Related Guides And Next Steps

- [Design system](../design-system/index.md) owns token, theme and icon conventions.
- [Data controls](../data-controls/index.md) owns table queries/editing/actions.
- [AppShell](../app-shell/index.md) provides the application frame.
