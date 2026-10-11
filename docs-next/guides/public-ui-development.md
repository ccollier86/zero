---
id: zero.guides.public-ui-development
type: how-to
audience: [agent, developer, maintainer]
owner: frontend
status: draft
visibility: internal
system: frontend
feature: public-ui-development
maturity: supported
applies_to: ["2.6.0 working source; existing public lane retained; upgrades unreleased"]
modes: [browser, SSR, public-pages, documentation]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Public UI Development

[Guides index](./index.md) · [Public components](../frontend/components/public-pages/index.md) · [Documentation index](../index.md)

Use this workflow for landing pages, marketing, articles, documentation and public
product demonstrations. Assemble Zero's public facades and parts into a coherent
page, with readable hierarchy and intentional effects. The public visual lane is
not an authorization rule. Dashboards follow [Application UI development](./application-ui-development.md).

The [UI reference](../frontend/ui-reference.md) is the canonical entrance for
component APIs, tokens, typography and action-to-animation choices. This guide
applies those contracts to public-page assembly rather than defining another
theme or motion policy. Public surfaces outside an application next-theme boundary
retain their existing theme; the dashboard replacement is not an automatic public
migration. Check installed availability before adopting working-source additions.

Library maintenance follows the same
[source organization](../frontend/components/source-organization.md) rules as
application controls. A canonical folder is not a new public import or a reason
to replace the public lane's existing behavior.

## Establish Access And Runtime Boundaries

1. Inspect the route/layout and declare actual anonymous access through the
   [router authentication contract](../frontend/router/authentication.md).
   `data-zero-page="public"` does not make a protected route public.
2. Choose static content, authorized dynamic content or a labeled illustrative
   demo. Do not render private records and hide them with styling; SSR output,
   HTML and assets must also be safe to disclose.
3. Reuse the root router/provider when present. Static composition needs no new
   SDK client, Sync socket or modal host. Dynamic features follow
   [AppProvider](../frontend/runtime/app-provider.md), not transport inside a card.
4. Keep credentials/provider calls/server configuration out of page modules.
   URL/asset safety and backend authorization remain application-owned.

Use declared package entries, not a guessed `/public-pages` package export or
private `#zero` alias. [Public configuration](../frontend/components/public-pages/configuration.md)
lists actual imports; [file routes](../frontend/router/file-routes.md) defines
layout/loader composition. Cache only intentionally public loader output.

## Choose The Visual Boundary Before Composing

Load the normal stylesheet once and establish the public page/surface markers
from [presentation lanes](../frontend/design-system/lanes.md). Pair public surface,
foreground, border, muted and accent roles. A public marker does not rewrite every
application-token component; use its declared styling slots when mixing families.

The [next foundation](../frontend/design-system/foundation-next.md) is scoped and
can be adopted explicitly when intended. Do not mark `<html>` or `<body>` merely
to change an embedded dashboard preview. Keep existing public navigation,
backgrounds and surfaces until their own migration is chosen and qualified.
The pure design-system API loads neither CSS nor fonts. The
[style build guide](../frontend/design-system/style-build.md) explains managed
versus app-owned class discovery; the [token reference](../frontend/design-system/tokens.md)
owns actual theme values.

Use one meaningful h1 and coherent section/card heading levels. Display roles
serve a main message; reading roles serve articles; compact support/technical/
analytical roles serve labels and data. Do not make every panel a hero or style
long reading as a dashboard control. [Typography](../frontend/design-system/typography.md)
explains optional Text/Heading and explicit role markers. Existing public families
retain their own defaults unless a declared slot/role is deliberately selected.
Test real fonts, wrapping, locale, contrast and zoom; a font stack is not a loader.

## Assemble Through Facades And Public Parts

| Responsibility | Facade or parts and use reminder |
| --- | --- |
| Primary navigation | [ResizableNavbar](../frontend/components/public-pages/navigation.md): floating/compact scroll behavior, magnetic hover and mobile menu. The caller supplies active routes. |
| First message and actions | [Hero / HeroActions](../frontend/components/public-pages/hero.md): one intentional title/copy/CTA hierarchy. Compact/full options control framing, not permissions. |
| Decorative backdrop | [Hero backgrounds](../frontend/components/public-pages/backgrounds.md): intentional preset/image/canvas layer, never transport status or essential information. |
| Features, CTA and footer links | [Section facades](../frontend/components/public-pages/sections.md): standardized copy/visual/action slots with app-owned destinations. |
| Questions and disclosures | [FAQ](../frontend/components/public-pages/faq.md): semantic questions/answers; required context must not depend on decorative reveals. |
| Code and commands | [CodeBlock](../frontend/components/public-pages/code-block.md): shared file/copy/highlight family; use its [composition](../frontend/components/public-pages/code-block-composition.md) and [rendering](../frontend/components/public-pages/code-block-rendering.md) APIs. |
| Showcase collections | [BentoGrid / AnimatedList](../frontend/components/public-pages/collections.md): stable caller-owned items; reveal timers are not realtime receipts or virtualization. |
| Standard summary or managed quick look | [Card parts / ContentCard](../frontend/components/surfaces/card.md): shared anatomy and deliberate details body through one existing modal host. |
| Legacy shared-layout gallery | [ExpandableCards](../frontend/components/public-pages/collections.md#expandablecards): separate existing contract; do not assume managed-dialog focus/guard guarantees. |
| Animated versus streamed copy | [Text effects](../frontend/components/text/effects.md) for illustrative copy; [StreamingText](../frontend/components/text/streaming-text.md) for a real supplied stream. |

Start with an assembled facade; use public parts/slots when content differs.
Custom native markup remains possible but retains semantic headings, accessible
action names and token pairs. Supply safe URLs/alt text; decorative icons should
not repeat an already named action. Reuse [named icons](../frontend/design-system/icons.md)
and their existing animation context instead of a second per-button animator.

The [component index](../frontend/components/index.md),
[primitive manuals](../frontend/components/primitives/index.md) and
[overlay manuals](../frontend/components/overlays/index.md) route every supported
family to its full API. Private blocks remain documented under their parent, not
advertised as standalone public exports. A new reusable public part needs its
complete reference and an index route; folder placement alone is not a contract.

CTA callbacks are not persistence services. For a real write, own pending/error
state and await the [accepted operation](../frontend/sdk/acknowledged-mutations.md)
before success. A notification failure after acceptance must not repeat it.
Use the [forms](../frontend/forms/index.md) contract rather than rebuilding
validation around a decorative card.

## Preserve Interaction Owners And Intentional Effects

Follow the [UI reference](../frontend/ui-reference.md) for each action's animation.
Keep navigation and menu magnetic material separate from committed selection.
Select list morphology, restrained anchored panels, managed dialog/Card expansion
and Tooltip/chart inspection are distinct, not one universal entrance. Preserve
the family's options and existing reduced-motion owner instead of layering a
page-wide animator around it.

Use [Popover](../frontend/components/overlays/popover.md) for interactive content,
not a focusable control inside [Tooltip](../frontend/components/overlays/tooltip.md).
Managed details/decisions reuse [modals](../frontend/modals/index.md); never mount
a host per card. Decorative text/background effects keep readable static content
and need verification of their actual reduced-motion behavior.

Use [ScrollArea](../frontend/components/primitives/scroll-area.md) for an ordinary
bounded reading region and [PopoverViewport](../frontend/components/overlays/popover.md#long-content-without-nested-scrolling)
for a long generic popup body. DropdownMenu/Select/Command/picker families already own
their actual scroller and Arc-style fades/rails: do not double-wrap them. Natural
long-page flow, message bottom-following and chart window controls differ.
Reduced motion never changes measurements, acceptance or genuine hold safety.

Older ContextMenu and custom-calendar surfaces need their own presentation
qualification; the shared recipe is not evidence that every override has migrated.

## Choose Measured Charts Or Labeled Illustrations

Use the [Zero Charts subsystem guide](../frontend/charts/index.md) for shared
API/data flow and links to all full family manuals: Sankey aggregate flow, Race
Bar history, Funnel conversion, twelve Arc analytical charts and handmade/native
quantitative, statistical, financial, polar and observed-time organisms. Choose
the measured geometry first, then read that family's exact composition contract.

Static props need no new provider. ZeroChart selects a typed presentation; it
does not fetch, authorize or generate measurements. Real public data comes from
an intentionally public server contract. Authorized live aggregates use
`useChartQuery` from `@zero/framework/charts/react` inside existing client
composition; do not expose private tables just to animate a landing demo.
Retain [existing Recharts](../frontend/components/primitives/charts.md) where
it is already the deliberate consumer choice.

Label synthetic data and [vector/ingestion public stories](../frontend/components/vector-visualization.md)
as illustrations. Particles, generated history, revealed rows and typing timers
are not live search, exact person paths, storage receipts or service health.
Real visualization uses accepted snapshots and actual operation IDs, with units,
measurement window, missing values, readiness and freshness explicit.

## Review Before Shipping Or Retiring Styles

- Review real SSR output and anonymous access, not only a logged-in browser.
- Check keyboard/mobile navigation, headings, focus return, narrow/zoomed layouts,
  images, long strings, dark mode and reduced motion in the actual page.
- Keep exact chart/readout data accessible without hover, animation or color.
- Check installed public exports and copied CSS/helper closure with
  [Doctor](../cli/doctor/source-audit.md#upgrade-auditing); static review is not
  visual, accessibility, authority or whole-project proof.
- Preserve customized copies, explicit effects and original theme infrastructure
  until the [retirement checklist](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely)
  is met. Cleanup must not silently change public imports or theme scope.
- Record unresolved consumer issues and follow [verification](./verification.md).
