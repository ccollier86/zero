---
id: zero.frontend.components.primitives.scroll-area
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: scroll-region
maturity: supported
applies_to: ["2.6.0 working source; Arc native-viewport treatment unreleased"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Bounded Scroll Regions

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import ScrollArea and ScrollBar from
`@zero/framework/components/ui/scroll-area`. Both retain their corresponding
Radix root/scrollbar props. ScrollArea owns one native Radix viewport with shared
Arc-style content fades and overlay rails. className applies to the root; its parent/root must have a
bounded height for useful body scrolling.

`ScrollAreaProps` adds `orientation="vertical" | "horizontal" | "both"`,
`fadeEdges=true` and `viewportRef` for the exact native viewport. Horizontal
intent remains explicit; the default is vertical. Children remain ordinary
mounted React content—there is no row virtualization, query pagination or
automatic selection preservation.

```tsx
import { ScrollArea } from '@zero/framework/components/ui/scroll-area';

export function Notes({ children }: { children: React.ReactNode }) {
  return <ScrollArea className="h-64 rounded-lg border border-border">{children}</ScrollArea>;
}
```

## Native Scrolling, Shared Presentation

Only real hidden content creates an affordance. Edge fades cover
`min(28px, hidden distance)` after a .5px threshold; fitting content has no fade
or rail. Rails sit outside the content mask, and borders/shadows are not masked.
Focused/active rows at an edge cap the fade before their label and 2px focus
margin; decoration does not move focus or implement selection.

The rail hit region is 11px; its painted thumb grows from 5px to 7px on hover,
uses a 28px minimum length and 30→46% foreground mix. Track clicks page 90% of
the viewport; thumb dragging, wheel, touch and keyboard still scroll the same
native element. Motion uses 160ms show, 480ms hide and 900ms linger. `type="hover"`
shows on mouse hover or scrolling, `scroll` only on scrolling/dragging, and
`auto`/`always` show a rail whenever that axis overflows. `scrollHideDelay`
remains an explicit override. Reduced motion removes transitions, not linger;
forced colors remove masks and use readable system paint.

Root axes are registered with Radix without displaying a second native thumb.
The exported low-level `ScrollBar` retains the genuine Radix scrollbar contract
and skin for custom compositions; its native 18px minimum geometry is not
misrepresented as the Root's 28px shared rail. Use Root `orientation` to request
axes in ordinary compositions rather than adding a duplicate bar.

Select, CommandList, TimePicker and the virtual year grid decorate their existing
viewports with the same internal adapter. They must not be wrapped in another
ScrollArea. Menu headers/footers outside those viewports remain unmasked and
fixed. Tables, chart progress bars and bottom-following message streams retain
their separate scroll/data contracts.

Keep accessible keyboard/focus targets in the content. For streaming messages
that follow the bottom, choose the separate scroll-anchoring public surface; a
plain ScrollArea does not auto-follow new output. Scope replacement belongs to
the data/controller, not a scrolling container.

## Related Guides And Next Steps

- [List/detail layout](./list-detail.md) composes a bounded details body.
- [Design-system external surfaces](../../design-system/external-surfaces.md) explains
  the separate upstream bottom-anchoring re-export.
- [Tables](./tables-and-pagination.md) has its own horizontal overflow wrapper.
- [Expanded scroll adoption plan](../../../_work/arc-scroll-surface-plan.md) records
  remaining modal/Sheet coverage, paging/snap/wheel improvements and deliberate
  old/new visibility options. These planned additions are not current props.
