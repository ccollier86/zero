---
id: zero.frontend.components.text.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: text-roadmap
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

# Text Presentation Roadmap

[Text index](./index.md) · [Documentation index](../../../index.md)

Known user plans include richer AI chat/prompt interfaces and document/editor
plugins, with shared design tokens and reusable helpers for Zero services. Those
are larger future compositions, not features implied by StreamingText.

- [ ] Evaluate full chat/message/prompt components against real app needs.
- [ ] Add deliberate rich-text/Markdown/document display and editing plugins with
  their own safety, persistence and autosave contracts.
- [ ] Improve device, reduced-motion and assistive-technology qualification of
  expressive public-copy effects.

Current text components remain string presentation. Do not describe future chat,
HTML sanitation or durable stream storage as existing behavior.

## Related Guides And Next Steps

- [Text index](./index.md) locates current controls.
- [AI gateway](../../../backend/ai/index.md) owns AI capabilities already implemented.
- [Design system](../../design-system/index.md) owns shared styling direction.
