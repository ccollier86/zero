---
id: zero.frontend.components.text.configuration
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: text-configuration
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

# Text Configuration And Ownership

[Text index](./index.md) · [Documentation index](../../../index.md)

All options are React props, not server env/config-file/Doctor settings. Text
components need no database/client to show public strings. The app still owns
the authorization/lifecycle of private source content.

| Component | Public entrance | Timing |
| --- | --- | --- |
| StreamingText | /components/streaming-text; root/react | speed characters/second; idle announcement 1000ms. |
| FlipWords | /components/text-effects; root/react | duration milliseconds between rotations. |
| TextGenerateEffect | /components/text-effects; root/react | duration/delay/stagger seconds (Motion transitions). |
| TypewriterEffect | /components/text-effects; root/react | typingSpeed/startDelay/loopDelay milliseconds. |

Prefix each path with `@zero/framework`. These grouping pages do not create a
/components/text package export. Use stable source identity for StreamingText and
parent-owned values for external streaming. Token classes/native span or div props
are caller presentation settings, not provider/model options.

## Related Guides And Next Steps

- [StreamingText props](./streaming-text.md) defines source precedence and callbacks.
- [Effect props](./effects.md) defines every effect option/default.
- [Runtime scope](../../runtime/index.md) owns identity/organization replacement.
