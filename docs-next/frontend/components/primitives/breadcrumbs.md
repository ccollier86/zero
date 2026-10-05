---
id: zero.frontend.components.primitives.breadcrumbs
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: breadcrumb-primitives
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

# Breadcrumb Primitives

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
BreadcrumbPage, BreadcrumbSeparator and BreadcrumbEllipsis from
`@zero/framework/components/ui/breadcrumb`.

Breadcrumb is a nav with a breadcrumb accessible label; BreadcrumbList is an
ordered list and BreadcrumbItem a list item. BreadcrumbLink follows native
anchor props plus asChild for a compatible custom link child. BreadcrumbPage
is a span marked aria-current='page' and aria-disabled; it is not clickable.
Separator defaults to a chevron, accepts custom children and remains decorative.
Ellipsis is also presentation, not a hidden automatic dropdown or truncation engine.

```tsx
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbPage, BreadcrumbSeparator } from '@zero/framework/components/ui/breadcrumb';

export function Location() {
  return <Breadcrumb><BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="/app">Workspace</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Projects</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList></Breadcrumb>;
}
```

The app owns path generation, route matching and permission-sensitive visibility.
For a declarative shell trail use AppShellBreadcrumbs instead of repeating this
composition. These primitives do not invoke router loaders or verify access.

## Related Guides And Next Steps

- [AppShell header](../../app-shell/header-and-account.md) takes breadcrumb descriptors.
- [Router navigation](../../router/navigation.md) supplies enhanced Link behavior.
- [Navigation controls](./tables-and-pagination.md) covers separate pagination links.
