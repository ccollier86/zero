---
id: zero.design-system.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Design-System Roadmap

[Design-system index](./index.md) · [Documentation index](../../index.md)

Semantic tokens, theme transitions/morph icon, animated pack, modern table
controls and existing public/application components are implemented capabilities.

Future user-requested direction:

- [ ] Continue public/landing/front-page component polish.
- [ ] Modal manager header/content/action layout improvements, especially close-button overlap.
- [ ] More adaptable control-plane/prefab blocks for platform/organization administration.
- [ ] Evaluate selected document viewers/editors, calendars, chat and other reusable plugins.
- [ ] Markdown-first documentation site using the same tokens.
- [ ] Targeted contrast, keyboard/assistive technology/reduced-motion/device/package style qualification.
- [ ] Refine the default theme and interaction vocabulary using the user's selected
  new components, preserving light/dark semantic tokens and consistent spacing,
  typography, focus and motion.
- [ ] Evaluate a separately installable icon package alongside the reusable UI
  package. Preserve familiar framework imports through an explicit compatibility
  boundary; avoid duplicate React contexts, icon registries or theme providers.

The [component roadmap](../components/roadmap.md) owns the distribution/dependency
plan. New references and package separation are future work, not changes to
current imports in this release.

These are ideas/plans, not APIs or a claim of present compliance. Confirmed
interaction/lifecycle defects get source corrections and tests rather than
being accepted as limitations. [Modals](../modals/index.md),
[current control conventions](./component-conventions.md) and
[agent plans](../../agents/tooling/roadmap.md) connect future work to existing
ownership.
