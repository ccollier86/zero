---
id: zero.frontend.overlays.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: roadmap
maturity: supported
applies_to: ["2.6.0 working source; later overlay expansion planned"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Overlay And Navigation Roadmap

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Current public menu/popover/tooltip/collapsible/sidebar/radial controls are real
implemented components; standard app layout is already supplied by AppShell.

Checked entries describe working-source capabilities; unchecked entries remain
planned work, not shipped interfaces:

- [ ] Continue coherent token/palette polish and component composition.
- [ ] Broader keyboard, screen-reader, touch/mobile and reduced-motion qualification.
- [ ] Evaluate richer permission-aware control-plane blocks without duplicating backend authority.
- [x] Standard managed modal/header/content/action layout is implemented in
  working source under the [modal roadmap](../../modals/roadmap.md).
- [ ] Complete [ordinary surface scroll adoption](../../../_work/arc-scroll-surface-plan.md)
  using existing viewports and Arc edge/rail presentation; preserve specialized
  table/editor owners and fixed chrome.
- [ ] Add [managed drawers and BottomSheet](../../../_work/drawer-bottom-sheet-system-plan.md)
  with coordinated mixed stacks, detents, gestures, guards and controlled/custom
  composition. This is a proposed facade, not a current replacement for Sheet.
- [ ] Package/version-verified component discovery for coding agents.

These plans do not excuse confirmed defects. Fix those with focused tests and
document their real corrected baseline. [Design roadmap](../../design-system/roadmap.md),
[modals](../../modals/index.md) and [agent tooling](../../../agents/tooling/index.md)
connect proposed work to existing systems.
