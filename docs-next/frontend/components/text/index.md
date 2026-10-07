---
id: zero.frontend.components.text.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: text-presentation
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

# Text Presentation

[Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

These components present caller-owned strings. They do not choose an AI provider,
run an agent, parse streamed HTTP events, persist an answer or render untrusted HTML.

- [StreamingText](./streaming-text.md) presents static, replayed and live string chunks.
- [Animated text](./effects.md) covers FlipWords, TextGenerateEffect and TypewriterEffect.
- [Table value replacement](./effects.md#table-value-replacement) explains the internal typing primitive reused by DataTable's public cell-motion option.
- [Configuration](./configuration.md) gives imports, timing units and ownership.
- [Roadmap](./roadmap.md) separates planned AI/editor composition from current controls.

Use [scroll anchoring](../scroll-anchoring.md) for a transcript that follows new
content, not ad-hoc scroll calls in every chunk callback.

## Related Guides And Next Steps

- [AI gateway](../../../backend/ai/index.md) produces authenticated server results.
- [Design system](../../design-system/index.md) supplies typography/tokens/motion.
- [Frontend runtime](../../runtime/index.md) owns session/scope/provider composition.
