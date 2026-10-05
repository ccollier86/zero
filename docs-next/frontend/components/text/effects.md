---
id: zero.frontend.components.text.effects
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: animated-text-effects
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

# Rotating, Revealed And Typewritten Copy

[Text index](./index.md) · [Documentation index](../../../index.md)

FlipWords, TextGenerateEffect and TypewriterEffect are exported from
`@zero/framework/components/text-effects`, root and React. Their Props types
are available from the same component subpath. These are marketing/local copy
animations, not live AI stream consumers.

```tsx
import { FlipWords, TextGenerateEffect, TypewriterEffect }
  from '@zero/framework/components/text-effects';

export function Intro() {
  return <section>
    <h1>Build <FlipWords words={['tools', 'workflows']} /></h1>
    <p><TextGenerateEffect words="Use your existing platform capabilities." /></p>
    <p><TypewriterEffect words={[{ text: 'Start' }, { text: 'small.' }]} /></p>
  </section>;
}
```

## Exact Props And Defaults

All three inherit native span props and className. FlipWords requires readonly
string[] words; duration=2200ms and wordClassName are optional. It trims/removes
blank words, renders nothing for an empty list, and reserves width using invisible
measuring words. One word does not schedule rotation. Updating the list length
resets the local index; intervals are component-owned and retired on changes/unmount.

TextGenerateEffect requires words:string. Optional duration=0.45 seconds,
delay=0 seconds,stagger=0.075 seconds,filter=true and wordClassName control Motion
word reveals. It trims/splits whitespace and rejoins display words with spaces,
so it is not a whitespace-preserving code/text view. Choose an outer semantic
heading/paragraph; the effect itself is an inline span.

TypewriterEffect requires readonly TypewriterWord[] (text plus optional className).
Optional cursorClassName,typingSpeed=42ms,startDelay=240ms,loop=false,
loopDelay=1400ms control local timing. It inserts spaces between segments; changes
to the text/class signature reset reveal progress. Looping restarts after its
pause; no onDone/provider receipt is exposed. The cursor is decorative, not a
transport-status signal. UTF-16 slicing is the current typing behavior; do not
infer Unicode-grapheme timing guarantees from a string API.

## Accessibility And Content

Use motion deliberately and verify reduced-motion/assistive technology behavior
for the actual page. Source ownership/timer cleanup is not proof that every effect
has the same reduced-motion policy. Keep an understandable semantic sentence
outside the animated slot and avoid using rotation to convey required state or
permission information. Never render private record content on public routes just
because an animation is decorative.

## Related Guides And Next Steps

- [StreamingText](./streaming-text.md) consumes live string sources.
- [Design-system motion](../../design-system/index.md) owns shared visual conventions.
- [AppShell](../../app-shell/index.md) uses quieter application-lane presentation.
