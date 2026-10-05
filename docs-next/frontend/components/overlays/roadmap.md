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
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Overlay And Navigation Roadmap

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Current public menu/popover/tooltip/collapsible/sidebar/radial controls are real
implemented components; standard app layout is already supplied by AppShell.

Future ideas, not shipped interfaces:

- [ ] Continue coherent token/palette polish and component composition.
- [ ] Broader keyboard, screen-reader, touch/mobile and reduced-motion qualification.
- [ ] Evaluate richer permission-aware control-plane blocks without duplicating backend authority.
- [ ] Modern modal/header/content/action layout refinement.
- [ ] Package/version-verified component discovery for coding agents.

These plans do not excuse confirmed defects. Fix those with focused tests and
document their real corrected baseline. [Design roadmap](../../design-system/roadmap.md),
[modals](../../modals/index.md) and [agent tooling](../../../agents/tooling/index.md)
connect proposed work to existing systems.
