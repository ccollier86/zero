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
applies_to: ["2.6.0 working source; composable Card/ContentCard upgrade unreleased"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Cards, Badges, Avatars And Separators

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import the corresponding `@zero/framework/components/ui/badge`, `/avatar`,
`/separator` and `/skeleton` modules. These primitives do not fetch records,
determine identity or produce loading state themselves.

[Card and ContentCard](../surfaces/card.md) now has the complete composition,
props, examples and managed quick-look contract. The
[Surfaces index](../surfaces/index.md) routes cards and identity surfaces without
changing their public imports.

## Standard Card Parts

Use [Standard Card Parts](../surfaces/card.md#standard-card-parts) for the full
native composition, density, semantic heading and independently usable parts.

## ContentCard And Managed Quick Look

Use [ContentCard And Managed Quick Look](../surfaces/card.md#contentcard-and-managed-quick-look)
for its full props, example, managed modal lifecycle and caller-owned boundaries.

## Badge

Badge accepts div props and variant default|secondary|destructive|warning|outline
(default default). badgeVariants is the module's style helper. A badge is visual
metadata: it does not grant the role or status written inside it.

## Avatar

Avatar, AvatarImage and AvatarFallback retain their Radix root/image/fallback
props. Source default size is 32px and rounded; provide image src/alt and fallback
content. The component does not compute user initials automatically (AppShell
and domain components do so themselves).

## Separator And Skeleton

Separator follows Radix with orientation='horizontal', decorative=true. Choose
vertical explicitly and give its parent a useful height. decorative separators
are presentation, not announced structural headings. Skeleton is a native div
with muted pulse styling; callers own shape, loading state and accessible status.
Do not replace meaningful content with an unlabeled indefinitely loading skeleton.

## Related Guides And Next Steps

- [List/detail layout](./list-detail.md) organizes these surfaces in control planes.
- [AppShell](../../app-shell/index.md) adds account/avatar descriptors.
- [Design system](../../design-system/index.md) owns reusable visual semantics.
