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

# Bounded Scroll Regions

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import ScrollArea and ScrollBar from
`@zero/framework/components/ui/scroll-area`. Both retain their corresponding
Radix root/scrollbar props. ScrollArea owns its viewport, a default vertical
scrollbar and corner. className applies to the root; its parent/root must have a
bounded height for useful body scrolling.

ScrollBar defaults orientation='vertical'; horizontal changes its geometry.
Add a horizontal scrollbar explicitly when your composition needs one; the root
does not infer horizontal intent from data width. Children remain ordinary
mounted React content—there is no row virtualization, query pagination or
automatic selection preservation.

```tsx
import { ScrollArea } from '@zero/framework/components/ui/scroll-area';

export function Notes({ children }: { children: React.ReactNode }) {
  return <ScrollArea className="h-64 rounded-lg border border-border">{children}</ScrollArea>;
}
```

Keep accessible keyboard/focus targets in the content. For streaming messages
that follow the bottom, choose the separate scroll-anchoring public surface; a
plain ScrollArea does not auto-follow new output. Scope replacement belongs to
the data/controller, not a scrolling container.

## Related Guides And Next Steps

- [List/detail layout](./list-detail.md) composes a bounded details body.
- [Design-system external surfaces](../../design-system/external-surfaces.md) explains
  the separate upstream bottom-anchoring re-export.
- [Tables](./tables-and-pagination.md) has its own horizontal overflow wrapper.
