---
id: zero.design-system
type: index
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: design-system
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Zero Design System

[Frontend index](../index.md) · [Documentation index](../../index.md)

Zero combines semantic light/dark tokens, reusable controls and animated icons.
The **application lane** stays quiet for dense working interfaces; the
**public lane** gives landing/content surfaces a more expressive vocabulary.
Neither lane is an authentication boundary.

## Guides And References

- [Tokens](./tokens.md): every source token's light/dark value and Tailwind mapping.
- [Lanes](./lanes.md): application versus public surface intent.
- [Configuration](./configuration.md): providers, switches and icon defaults.
- [Themes](./themes.md): persistence, morphing switch and circular-transition fallbacks.
- [Named icons](./icons.md): public aliases and semantic use.
- [Icon registry](./icon-registry.md): safe typed/dynamic lookup.
- [Icon animation](./icon-animation.md): triggers/context/helpers and lifecycle.
- [Component conventions](./component-conventions.md): reusable controls, tokens and extension points.
- [Style builds](./style-build.md): managed scanning/hashed output versus own CSS pipeline.
- [External surfaces](./external-surfaces.md): toast/scroll reexports and attribution.
- [Roadmap](./roadmap.md): planned polish and evidence still needed.

## Integration And Inferred Principles

Mount [ThemeProvider](./themes.md) and the integrated
[AppProvider](../runtime/index.md) in their respective roles. ThemeProvider
controls presentation; AppProvider owns the client/auth/sync/session scope.
Use [data controls](../data-controls/index.md),
[forms](../forms/index.md) and [modals](../modals/index.md) instead of recreating
their interactions in every screen.

Inferred philosophy: semantic tokens let a product restyle coherent components
without duplicating per-screen palettes. Prefer composable props/slots, stable
layout and intentional motion. Backend Guardian still enforces permissions;
a colored badge or hidden control never grants authority.

These drafts inspect source and focused corrections; no whole-system contrast,
screen-reader, mobile-device or exact installed-style qualification is claimed.
