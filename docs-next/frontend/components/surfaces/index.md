---
id: zero.frontend.components.surfaces.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: surfaces
maturity: supported
applies_to: ["2.6.0 working source; canonical Card manual and existing identity-surface routes"]
modes: [browser, SSR, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Surface Components

[Component index](../index.md) · [Canonical UI reference](../../ui-reference.md) · [Frontend index](../../index.md)

Surfaces organize content, identity and local status. Choose Card parts for
arbitrary composition, ContentCard for a standardized article and managed quick
look, or a focused identity primitive for a smaller visual role. Callers still
own the content, accessible naming, loading state and business actions.

This directory is the canonical documentation home for
[Card and ContentCard](./card.md).
Badge, Avatar, Separator and Skeleton keep their existing manual and public
imports. A documentation folder is not a new wildcard package API.

## Choose The Surface

| Task | Full manual | Boundary |
| --- | --- | --- |
| Compose a native card | [Card and standard parts](./card.md#standard-card-parts). | Native props, refs, semantic headings and arbitrary children; no required content schema. |
| Show an article with optional quick look | [ContentCard](./card.md#contentcard-and-managed-quick-look). | Standard media, byline, status and action slots; one existing ModalManager owns details. |
| Display compact status metadata | [Badge](../primitives/surfaces.md#badge). | Visual metadata, not a grant of permission or proof of status. |
| Display a person's image or fallback | [Avatar](../primitives/surfaces.md#avatar). | Caller-provided image, alt text and fallback; no identity lookup or automatic initials. |
| Divide content or show a loading shape | [Separator and Skeleton](../primitives/surfaces.md#separator-and-skeleton). | Decorative structure and caller-owned loading meaning. |

## Composition And Shared Presentation

Use the [canonical UI reference](../../ui-reference.md) for typography, theme
tokens and motion roles. Card density is a family variant, not a replacement for
the application-wide density marker. Native styles and documented local token
aliases remain available where a standard part needs a deliberate adjustment.

ContentCard details reuse the existing [modal system](../../modals/index.md).
Mount one manager at the application boundary or reuse the AppProvider host;
do not add a manager per card. Preview actions remain independently focusable,
and details content is deliberate rather than a duplicated preview tree.

## Ownership And Related Guides

Presentation callbacks do not establish persistence, authorization or async
acknowledgment. Keep data access and accepted writes with the existing
application workflow. The [source-organization guide](../source-organization.md)
owns the physical family, compatibility facades and source-copy boundaries.

- [List/detail layout](../primitives/list-detail.md) composes control-plane
  surfaces.
- [DenseList](../dense-list.md) handles rows with independently interactive
  trailing controls.
- [Public-page collections](../public-pages/collections.md#expandablecards)
  retains the distinct ExpandableCards gallery contract.
- [AppShell](../../app-shell/index.md) adds account and avatar descriptors.
- [Design system](../../design-system/index.md) owns reusable visual semantics.
