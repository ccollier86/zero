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
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Reusable Components

[Frontend index](../index.md) · [Documentation index](../../index.md)

Use the smallest component that owns the interaction you need. Domain organisms
have their own manuals; primitives do not perform authentication, queries or
persistence simply because they are exported by Zero.

- [Primitives](./primitives/index.md) covers inputs, selection, dates, surfaces,
  semantic tables, charts and compact list/detail layout.
- [Controls](./controls/index.md) locates focused control-family manuals,
  including native Morph Select and its rich options/scrolling contract.
- [Floating Button Group](./controls/floating-button-group.md) covers additive
  stationary action trays, magnetic/press paint, reserved labels and native
  focus/ref access, without replacing joined controls or selection.
- [Surfaces](./surfaces/index.md) locates focused surface-family manuals,
  starting with composable Card and managed ContentCard quick looks.
- [Typography](../design-system/typography.md) covers shared text recipes and
  optional native Text/Heading without requiring wrappers around controls.
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
- [Dense settings lists](./dense-list.md) covers grouped native rows with optional
  media, trailing controls and safe single-action picker composition.
- [Vector visualizations](./vector-visualization.md) covers real ingestion/search
  organisms, tool-operation attachment, external adapters and public stories.
- [Email Inbox](../email/index.md) covers the optional folder/message workspace,
  safe HTML reader, rich composer and scoped mail controller/parts.
- [Zero Charts API and families](../charts/index.md) routes the shared facade,
  reactive data/runtime rules and five full manuals alongside Recharts compatibility.
- [Sankey flow](../charts/sankey.md) covers proportional flow math, compact inspection
  and bounded reactive aggregate collections.
- [Arc charts](../charts/arc.md) covers twelve separately organized chart organisms,
  their admitted models, controls, shared tokens and the existing reactive bridge.
- [Handmade charts](../charts/native.md) covers quantitative/mixed Cartesian,
  statistical, polar and observed-time organisms, the typed ZeroChart facade,
  exact data companions and original SVG geometry.
- [Race Bar chart](../charts/race-bar.md) covers ranking-over-time, spring-driven
  playback, scrubbing, controlled state and exact aggregate-history inspection.
- [Funnel chart](../charts/funnel.md) covers total/split/isolated conversion cohorts,
  responsive bands, aggregate-derived flow and exact stage inspection.
- [Integration settings list](./integration-settings-list.md) covers flat/grouped
  service rows, labeled status, confirmed actions and app-owned target lifetimes.
- [JSON editor](./json-editor.md) covers the retained structured editor and additive
  Tree/Code document editor for JSON/YAML/TOML/literal `.env`, source-preserving
  comments, local history and accepted-save feedback.
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
- [Source and documentation organization](./source-organization.md) locates
  canonical owners, compatibility facades, transitive copy dependencies and
  the system/manual hierarchy without changing supported application imports.
- [Source organization plan](../../_work/frontend-component-organization-plan.md)
  separates canonical family ownership from supported import and source-copy
  paths. Card/Select, date/time, Popover, shared overlay mechanisms and curated
  frontend exports are organized; larger engines and client families remain staged.

This overview is reviewed against Zero 2.6.0. Each feature guide records its
own evidence; this index does not claim every component/device combination
has independent package and browser qualification.

## Related Guides And Next Steps

- [Design system](../design-system/index.md) owns token, theme and icon conventions.
- [Data controls](../data-controls/index.md) owns table queries/editing/actions.
- [AppShell](../app-shell/index.md) provides the application frame.

## Retained Chart Documentation Routes

These previous locations preserve old section links and route to the canonical
chart manuals. They contain no separate API or copied examples:

- [Previous Sankey route](./charts.md): canonical aggregate-flow manual.
- [Previous Race Bar route](./race-bar-chart.md): canonical ordered-history manual.
- [Previous Funnel route](./funnel-chart.md): canonical conversion manual.
- [Previous Arc route](./arc-charts.md): canonical twelve-chart family manual.
- [Previous handmade route](./native-charts.md): canonical native analytical manual.
