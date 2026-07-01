# Public Components

Zero includes tokenized public-page components for marketing pages, docs,
content pages, public onboarding, and intake flows. They use the public token
lane documented in [Design Tokens](./design-tokens.md) and are exported from
both `@zero/framework/react` and narrow component package paths.

Use these components before copying source from Aceternity, Magic UI, or other
reference libraries. Zero's versions keep the useful motion patterns while
matching the platform icon, token, light/dark, and `zero add` contracts.

## Imports

```tsx
import {
  AnimatedList,
  AnimatedListCard,
  BentoGrid,
  BentoGridItem,
  BentoGridSkeleton,
  ExpandableCards,
  Faq,
} from '@zero/framework/react';
```

Prefer narrow imports in reusable app code:

```tsx
import { Faq } from '@zero/framework/components/faq';
import { ExpandableCards } from '@zero/framework/components/expandable-card';
import { BentoGrid, BentoGridItem } from '@zero/framework/components/bento-grid';
import { AnimatedList, AnimatedListCard } from '@zero/framework/components/animated-list';
```

If an app needs to own and modify source:

```sh
zero add components/faq
zero add components/expandable-card
zero add components/bento-grid
zero add components/animated-list
```

## FAQ

`Faq` renders an accessible accordion section. String answers use
`TextGenerateEffect` by default, so expanded answers reveal word-by-word. Pass
`animateAnswers={false}` for static answers or when the answer is rich React
content.

```tsx
import { Faq } from '@zero/framework/components/faq';

const items = [
  {
    id: 'deploy',
    iconName: 'terminal',
    question: 'Can I deploy Zero as one server?',
    answer: 'Yes. Zero is built around Bun, Elysia, SSR, local storage, sync, and one deployable app runtime.',
  },
  {
    id: 'public-flows',
    iconName: 'lock',
    question: 'Can public routes avoid the dashboard shell?',
    answer: 'Yes. Put public pages in a route group without AppShell and protect only the dashboard layout.',
  },
];

export function ProductFaq() {
  return (
    <Faq
      items={items}
      description="Common platform questions answered without leaving the page."
      defaultOpenIds={['deploy']}
    />
  );
}
```

## Expandable Cards

`ExpandableCards` keeps the Aceternity shared-layout animation shape: preview
card, image, title, description, and action share `layoutId`s with the expanded
surface; the overlay fades, Escape closes, outside click closes, and body scroll
locks while expanded.

Use it for feature cards, playlists, team cards, case studies, docs teasers, or
any public section where a compact card should open into a richer read panel.

```tsx
import { ExpandableCards } from '@zero/framework/components/expandable-card';

const cards = [
  {
    id: 'sync',
    title: 'Reactive data',
    description: 'Local-first table updates with WebSocket fanout.',
    imageSrc: '/images/sync-preview.webp',
    actionLabel: 'Read',
    actionHref: '/docs/sync',
    content: (
      <p>
        Define a table once, subscribe from React, and mutate through the Zero
        SDK or backend services. The UI stays live without app-specific socket
        wiring.
      </p>
    ),
  },
];

export function FeatureCards() {
  return <ExpandableCards items={cards} variant="grid" />;
}
```

## Bento Grid

`BentoGrid` and `BentoGridItem` provide a tokenized public bento layout. Cards
accept `header`, `children`, `icon`, `iconName`, and a fixed `span` value.
Spans are mapped to static Tailwind classes so copied apps do not depend on
dynamic class generation.

```tsx
import {
  BentoGrid,
  BentoGridItem,
  BentoGridSkeleton,
} from '@zero/framework/components/bento-grid';

export function FeatureGrid() {
  return (
    <BentoGrid columns={3}>
      <BentoGridItem
        iconName="layers"
        title="Hot SQLite"
        description="Memory-first active database with snapshot recovery."
        header={<BentoGridSkeleton />}
      />
      <BentoGridItem
        span={2}
        iconName="settings"
        title="Workflow ready"
        description="Compose backend jobs, AI calls, notifications, and storage."
        header={<BentoGridSkeleton />}
      />
    </BentoGrid>
  );
}
```

Use icon names from `@zero/framework/icons`. If the animated icon pack does not
yet include a needed icon, pass a React `icon` node.

## Animated List

`AnimatedList` adapts Magic UI's sequenced reveal behavior: children appear one
at a time with a spring scale/opacity animation and newest items render first.
`AnimatedListCard` is an optional Zero skin for notifications, activity, event
streams, and landing-page proof points.

```tsx
import {
  AnimatedList,
  AnimatedListCard,
} from '@zero/framework/components/animated-list';

export function ActivityProof() {
  return (
    <div className="relative h-[28rem] overflow-hidden">
      <AnimatedList delay={700}>
        <AnimatedListCard title="User signed in" description="Auth system" meta="10m ago" iconName="user" />
        <AnimatedListCard title="Workflow finished" description="Intake PDF generated" meta="4m ago" iconName="check" />
        <AnimatedListCard title="File uploaded" description="Private storage bucket" meta="2m ago" iconName="upload" />
      </AnimatedList>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-public-background" />
    </div>
  );
}
```

## Reference Sources

Zero's implementations were adapted to the platform from:

- Aceternity FAQ blocks: <https://ui.aceternity.com/blocks/faqs>
- Aceternity expandable cards: <https://ui.aceternity.com/components/expandable-card>
- Aceternity bento grid: <https://ui.aceternity.com/components/bento-grid>
- Magic UI animated list: <https://magicui.design/docs/components/animated-list>
