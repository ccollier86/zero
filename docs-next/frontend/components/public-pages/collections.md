---
id: zero.frontend.components.public-pages.collections
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: public-content-collections
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

# Bento, Animated Lists And Expandable Cards

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

These families display caller-owned content. They do not query a collection,
subscribe to notifications, grant access or implement a durable workflow.
Import the `/bento-grid`, `/animated-list` and `/expandable-card` component
subpaths below `@zero/framework`, or the root/React barrel.

## BentoGrid

BentoGridProps extends div props with columns=3 (2|3|4) and children. Mobile uses
one column; the declared count applies at md. BentoGridItemProps extends article
props except title: title,description,header,icon,iconName,span=1 (1|2|3|4) and
children optional. header takes precedence over children; custom icon precedes
iconName. BentoGridSkeleton is a styled div placeholder; it does not infer loading.
Keep spans coherent with the parent columns and give meaningful assets names.

```tsx
import { BentoGrid, BentoGridItem } from '@zero/framework/components/bento-grid';
import { AnimatedList, AnimatedListCard } from '@zero/framework/components/animated-list';

export function Showcase() {
  return <>
    <BentoGrid columns={2}><BentoGridItem title="Example" description="Caller-owned content." /></BentoGrid>
    <AnimatedList delay={800}><AnimatedListCard title="Example event" description="Synthetic display only." /></AnimatedList>
  </>;
}
```

## AnimatedList

AnimatedListProps extends div props with required children and delay=1000ms.
It reveals the first child initially, then additional children one at a time,
showing admitted children in reverse/newest-first order. Changing child count
resets the local index; timers retire on changes/unmount. It is not virtualization
or an infinite/persisted event log. AnimatedListItem requires children and adds
the shared spring wrapper. AnimatedListCardProps extends figure props except
title: title required;description,meta,icon,iconName='bell',color='var(--public-accent)'
optional. Custom icon precedes registry icon. Stable child keys avoid replaying
unrelated item state when an app changes its list.

## ExpandableCards

ExpandableCardsProps extends div props: items required,variant list|grid (list),
defaultActiveId=null,activeId,onActiveIdChange,renderAction(item,preview|expanded),
overlayClassName,cardClassName,expandedClassName,emptyState. Item requires id/title;
description,imageSrc,imageAlt,actionLabel,actionHref,content (node or render function),
meta optional. IDs must be unique/stable; activeId controls selection when supplied,
including null. An unknown ID produces no active item. Default IDs are initial only.

Card click/Enter/Space requests expansion. Escape/outside click closes; expansion
locks body scroll and cleanup restores its earlier overflow. Mobile has a close
button. Built-in action links stop propagation so a navigation action does not
also expand a card. renderAction replaces action presentation for each location.
Empty items use caller emptyState or a simple no-cards message. This custom
shared-layout gallery is not the Radix Dialog or global modal-manager API; do not
assume their focus-trap/ARIA contracts from the visual overlay alone. Use the
modal system for required confirmations or protected operational commands.

## Related Guides And Next Steps

- [Notifications](../../notifications/index.md) owns actual inbox data.
- [Modals](../../modals/index.md) owns confirmation/lifecycle guarantees.
- [Public sections](./sections.md) supplies semantically structured surrounding copy.
