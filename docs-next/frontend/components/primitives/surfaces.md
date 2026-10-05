---
id: zero.frontend.components.primitives.surfaces
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: surfaces-identity
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

# Cards, Badges, Avatars And Separators

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import the corresponding `@zero/framework/components/ui/card`, `/badge`,
`/avatar`, `/separator` and `/skeleton` modules. These primitives do not fetch
records, determine identity or produce loading state themselves.

Card, CardHeader, CardDescription, CardContent and CardFooter accept native div
props. CardTitle also accepts asChild=false; use a heading child when semantic
heading structure is needed, because its default is a div. Source padding is
header/content/footer 20px, with content/footer top padding removed. className
can customize spacing while keeping [tokens](../../design-system/tokens.md).

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@zero/framework/components/ui/card';

export function Summary() {
  return <Card><CardHeader><CardTitle asChild><h2>Summary</h2></CardTitle></CardHeader>
    <CardContent>Application-owned content.</CardContent></Card>;
}
```

Badge accepts div props and variant default|secondary|destructive|warning|outline
(default default). badgeVariants is the module's style helper. A badge is visual
metadata: it does not grant the role or status written inside it.

Avatar, AvatarImage and AvatarFallback retain their Radix root/image/fallback
props. Source default size is 32px and rounded; provide image src/alt and fallback
content. The component does not compute user initials automatically (AppShell
and domain components do so themselves).

Separator follows Radix with orientation='horizontal', decorative=true. Choose
vertical explicitly and give its parent a useful height. decorative separators
are presentation, not announced structural headings. Skeleton is a native div
with muted pulse styling; callers own shape, loading state and accessible status.
Do not replace meaningful content with an unlabeled indefinitely loading skeleton.

## Related Guides And Next Steps

- [List/detail layout](./list-detail.md) organizes these surfaces in control planes.
- [AppShell](../../app-shell/index.md) adds account/avatar descriptors.
- [Design system](../../design-system/index.md) owns reusable visual semantics.
