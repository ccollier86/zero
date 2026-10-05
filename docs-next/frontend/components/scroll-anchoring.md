---
id: zero.frontend.components.scroll-anchoring
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: bottom-scroll-anchoring
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

# Bottom Scroll Anchoring

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

Zero re-exports StickToBottom, useStickToBottom and useStickToBottomContext from
use-stick-to-bottom through its root/React barrel. The upstream library owns the
algorithm and MIT attribution; this is not a new Zero transport/state service.
The inspected installed dependency is 1.1.6. Revalidate its exact version when
qualifying another package instead of assuming the same options forever.

```tsx
import { StickToBottom, useStickToBottomContext, Button } from '@zero/framework/react';

function FollowLatest() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return isAtBottom ? null : <Button type="button"
    onClick={() => { void scrollToBottom(); }}>Latest</Button>;
}

export function Transcript({ children }: { children: React.ReactNode }) {
  return <StickToBottom className="relative h-96" resize="smooth" initial="smooth">
    <StickToBottom.Content className="space-y-3">{children}</StickToBottom.Content>
    <FollowLatest />
  </StickToBottom>;
}
```

The bounded host and Content own scroll/content refs. Scrolling up can release
automatic following; the explicit button requests it again. Do not force the
scroll position for every string chunk while the user reads earlier content.

## Public Props, Hook And Types

StickToBottomProps extends div attributes except children plus options:
initial (Animation|boolean),resize (Animation),mass,damping,stiffness,
targetScrollTop(GetTargetScrollTop),contextRef and optional instance. children
can be a node or a context render function. Content accepts native div props,
node/context-function children and scrollClassName. It must be within its root.

useStickToBottom(options) returns contentRef,scrollRef,scrollToBottom,stopScroll,
isAtBottom,isNearBottom,escapedFromLock and state. Apply both refs to the proper
content/scroll elements when composing your own view. The context hook requires
a StickToBottom parent; it additionally exposes targetScrollTop getter/setter.

Exported types include Animation,SpringAnimation,ScrollElements,
GetTargetScrollTop,ScrollToBottom,ScrollToBottomOptions,StopScroll,
StickToBottomOptions/Instance/State/Context/Props. Animation accepts browser
ScrollBehavior or spring options. scrollToBottom can return boolean or
Promise<boolean>; options include animation,wait,ignoreEscapes,
preserveScrollPosition and duration. Use the upstream contract, not an invented
always-Promise signature. Internal state is measurement/animation state, not
persisted user preferences. Ignore-escape policies should be deliberate.

This is browser layout behavior using resize/scroll observation. It does not
cancel an AI producer, authorize messages, virtualize rows or retain history.
Exact device/accessibility qualification is separate from a source/types audit.

## Related Guides And Next Steps

- [StreamingText](./text/streaming-text.md) presents caller-owned chunks.
- [ScrollArea](./primitives/scroll-area.md) provides ordinary bounded scrolling.
- [External surfaces](../design-system/external-surfaces.md) explains dependency attribution.
