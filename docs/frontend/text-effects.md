# Text Effects

Zero provides small public text-effect components for Hero titles, landing-page
copy, docs headers, and content pages. They are client components, use Motion,
and stay independent from `Hero` so app code can compose them anywhere a
`ReactNode` is accepted.

Use these effects sparingly. The plain sentence should remain readable and
meaningful without animation.

## Import

```tsx
import { FlipWords, TextGenerateEffect, TypewriterEffect } from '@zero/framework/react';
```

Narrow package-mode import:

```tsx
import {
  FlipWords,
  TextGenerateEffect,
  TypewriterEffect,
} from '@zero/framework/components/text-effects';
```

## TextGenerateEffect

`TextGenerateEffect` reveals a string word-by-word with optional blur.

```tsx
<TextGenerateEffect
  words="Build serious apps with less wiring."
  duration={0.45}
  stagger={0.075}
/>
```

Useful props:

| Prop | Default | Purpose |
| --- | --- | --- |
| `words` | required | String to split and reveal word by word. |
| `duration` | `0.45` | Animation duration per word, in seconds. |
| `delay` | `0` | Initial delay before the first word starts. |
| `stagger` | `0.075` | Delay between words, in seconds. |
| `filter` | `true` | Adds/removes blur while words reveal. |
| `wordClassName` | | Class applied to each word span. |

## TypewriterEffect

`TypewriterEffect` reveals segmented words one character at a time. Use
segments when one word or phrase needs custom styling.

```tsx
<TypewriterEffect
  words={[
    { text: 'one' },
    { text: 'Zero', className: 'text-public-accent' },
    { text: 'framework.' },
  ]}
  cursorClassName="bg-public-accent"
/>
```

Useful props:

| Prop | Default | Purpose |
| --- | --- | --- |
| `words` | required | Array of `{ text, className? }` segments. |
| `cursorClassName` | | Class applied to the blinking cursor. |
| `typingSpeed` | `42` | Delay between characters, in milliseconds. |
| `startDelay` | `240` | Delay before typing starts, in milliseconds. |
| `loop` | `false` | Whether to restart after the full phrase is typed. |
| `loopDelay` | `1400` | Delay before a loop restart, in milliseconds. |

## FlipWords

`FlipWords` rotates through a list while reserving enough inline space for the
widest word, which prevents layout shift in headings.

```tsx
<span>
  Build{' '}
  <FlipWords
    words={['beautiful UI', 'fast apps', 'agent-ready blocks']}
    wordClassName="font-semibold text-public-accent"
  />.
</span>
```

Useful props:

| Prop | Default | Purpose |
| --- | --- | --- |
| `words` | required | Strings to rotate through. Empty strings are ignored. |
| `duration` | `2200` | Time each word remains visible, in milliseconds. |
| `wordClassName` | | Class applied to measuring and animated word spans. |

## Hero Composition

`Hero.title` and `Hero.description` both accept `ReactNode`, so text effects can
be used without forking the Hero component:

```tsx
<Hero
  title={
    <>
      <TextGenerateEffect words="Build serious apps with" />
      <span className="block text-public-accent">
        <TypewriterEffect
          words={[
            { text: 'one' },
            { text: 'Zero' },
            { text: 'framework.' },
          ]}
        />
      </span>
    </>
  }
  description={
    <>
      One platform for{' '}
      <FlipWords words={['apps', 'dashboards', 'public flows']} />.
    </>
  }
/>
```

## Source Copy

Use `zero add` only when an app needs to customize the source:

```sh
zero add components/text-effects
```
