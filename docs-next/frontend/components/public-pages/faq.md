---
id: zero.frontend.components.public-pages.faq
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: faq-disclosure
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

# FAQ Disclosure

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import Faq/FaqProps/FaqItem from `@zero/framework/components/faq`, root or React.
items is a required readonly FaqItem array: each item needs stable id,question,
answer; eyebrow,icon,iconName are optional. Values are ReactNodes, not interpreted
HTML or AI generation requests.

```tsx
import { Faq } from '@zero/framework/components/faq';

export function HelpQuestions() {
  return <Faq animateAnswers={false} items={[
    { id: 'start', question: 'Where do I begin?', answer: 'Start with the example app.' },
  ]} />;
}
```

Optional FaqProps: title='Frequently asked questions',description,
defaultOpenIds=[],allowMultiple=false,animateAnswers=true,headerClassName,
listClassName,itemClassName,questionClassName,answerClassName,emptyState and native
section props/className. Default open IDs initialize local state; there is no
controlled openIds prop or automatic URL synchronization. Toggling closes the
same item; single mode replaces other open IDs, multiple mode retains them.

Questions use labeled buttons with aria-expanded/aria-controls. Empty items
render supplied emptyState or a simple no-questions message. String answers may
use TextGenerateEffect when animateAnswers is true; other content stays caller
content. This 'generate' is a word reveal animation, not an AI call. Use false
for quiet/accessibility-sensitive long answers, and verify the actual page's
motion/focus/read order rather than assuming every device from source inspection.

## Related Guides And Next Steps

- [Text effects](../text/effects.md) explains answer animation.
- [Public sections](./sections.md) supplies surrounding page structure.
- [Router](../../router/index.md) owns page access and URL navigation.
