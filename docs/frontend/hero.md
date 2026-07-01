# Hero

`Hero` is Zero's public-page hero section for landing pages, docs, blogs,
public intake flows, and content sites. It is full-bleed, uses the
public/frontend token lane, and accepts background and title slots so visual
effects can be swapped without forking the section.

Use `AppShell` for dashboards. Use `ResizableNavbar` plus `Hero` for public
route trees.

## Import

```tsx
import { Hero } from '@zero/framework/react';
```

Narrow package-mode import:

```tsx
import { Hero, HeroImageBackground, WavyBackground } from '@zero/framework/components/hero';
```

## Basic Usage

```tsx
import { Hero, ResizableNavbar } from '@zero/framework/react';

export default function PublicHome() {
  return (
    <div data-zero-page="public" className="zero-public-page">
      <ResizableNavbar
        brand={{ label: 'Zero', href: '/' }}
        items={[
          { label: 'Docs', href: '/docs' },
          { label: 'Components', href: '/components' },
        ]}
        actions={[{ label: 'Get Started', href: '/docs/start' }]}
      />

      <Hero
        eyebrow="Bun + Elysia + React"
        title="Build serious web apps without stitching ten services together."
        description="Zero gives you auth, sync, storage, workflows, AI, vector search, migrations, and polished UI from one framework surface."
        actions={[
          { label: 'Start Building', href: '/docs/start' },
          { label: 'View Components', href: '/components', variant: 'outline' },
        ]}
      />
    </div>
  );
}
```

## Backgrounds

Built-in presets:

```tsx
<Hero title="Launch faster" background={{ preset: 'aurora' }} />
<Hero title="Launch faster" background={{ preset: 'gradient' }} />
<Hero title="Launch faster" background={{ preset: 'stars', interactive: true }} />
<Hero title="Launch faster" background={{ preset: 'bubbles', interactive: true }} />
<Hero title="Launch faster" background={{ preset: 'wavy' }} />
<Hero title="Launch faster" background={{ preset: 'hexagon' }} />
<Hero title="Launch faster" background={{ preset: 'none' }} />
```

Use `WavyBackground` directly when a page needs custom wave colors, opacity, or
speed:

```tsx
<Hero
  title="Launch faster"
  background={{
    custom: (
      <WavyBackground
        className="size-full"
        colors={['#38bdf8', '#818cf8', '#e879f9']}
        speed="slow"
      />
    ),
  }}
/>
```

For product, person, venue, or object-focused pages, prefer a real or generated
image/video/custom visual background instead of a purely decorative gradient:

```tsx
import { Hero, HeroImageBackground } from '@zero/framework/components/hero';

<Hero
  title="See every intake in one clean clinical workflow."
  background={{
    custom: (
      <HeroImageBackground
        src="/images/intake-dashboard.jpg"
        alt="Clinic intake dashboard"
      />
    ),
  }}
/>
```

Any React node can be passed through `background.custom`, so future Animate UI
backgrounds can be used immediately:

```tsx
<Hero
  title="Realtime tools without realtime wiring."
  background={{
    custom: <MyFutureBackground className="size-full" />,
    overlayClassName: 'bg-public-background/55',
  }}
/>
```

## Text Effects

`title` is a `ReactNode`. Use a plain string for normal headings or pass Zero's
text-effect components for the part that should animate:

```tsx
import { FlipWords, TextGenerateEffect, TypewriterEffect } from '@zero/framework/components/text-effects';

<Hero
  title={
    <>
      <TextGenerateEffect words="Build apps with" />
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
      One platform for <FlipWords words={['dashboards', 'docs', 'public flows']} />.
    </>
  }
/>
```

Keep the H1 readable without animation. Text effects should enhance a phrase,
not carry the entire meaning of the hero.

See [Text Effects](./text-effects.md) for the standalone APIs.

## Layout

```tsx
<Hero
  align="left"
  size="compact"
  titleAs="h2"
  title="A focused section hero"
/>
```

| Prop | Default | Purpose |
| --- | --- | --- |
| `align` | `center` | `center` or `left` content alignment. |
| `size` | `default` | `compact`, `default`, or `full` height/padding preset. |
| `as` | `section` | Root element, `section` or `header`. |
| `titleAs` | `h1` | Heading element, `h1` or `h2`. |

## Styling

`Hero` uses Zero's public token lane:

- `public-background`
- `public-foreground`
- `public-muted-foreground`
- `public-glass`
- `public-accent`
- `public-accent-soft`
- `public-border`
- `public-ring`

Wrap public route trees in `zero-public-page` or `data-zero-page="public"` so
the page background and selection color match the Hero and navbar.

Do not fork Hero for one-off page designs. Prefer `background.custom`, public
token overrides, or the provided className slots.

## Source Copy

Use `zero add` only when an app needs to customize the source:

```sh
zero add components/hero
```
