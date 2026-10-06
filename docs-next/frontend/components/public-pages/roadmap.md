---
id: zero.frontend.components.public-pages.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: public-page-roadmap
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, public pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Public-Page Roadmap

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Known user direction includes nicer landing/main-site components, a Markdown-first
documentation plugin, richer document editors/readers, a blogging plugin and a
full calendar experience. These are larger future modules, not features inferred
from the current content component exports.

- [ ] Refine public/front-page composition using real Zero site/app examples.
- [ ] Build the separate Markdown documentation-site plugin after content/navigation
  and public-projection requirements are settled.
- [ ] Evaluate blogging/calendar/document plugins with explicit backend lifecycle,
  authorization and autosave contracts.

Current rendering defects are fixed/tested during this audit, not deferred as
roadmap ideas. Device, keyboard, motion and assistive-technology coverage still
requires appropriate real component qualification before public verification.

The [complete CodeBlock family](./code-block.md) is now an authorized
working-source implementation on the 2.4.0 baseline, not a deferred richer-code
idea. Composable parts, copy/morph, file/package controls, token syntax and
shared highlight/server/Markdown features are covered by focused source checks;
their release/artifact qualification remains separate from this roadmap.

## Related Guides And Next Steps

- [Public-page index](./index.md) locates current reusable components.
- [Text roadmap](../text/roadmap.md) tracks related chat/editor presentation ideas.
- [Design-system roadmap](../../design-system/roadmap.md) owns shared visual evolution.
