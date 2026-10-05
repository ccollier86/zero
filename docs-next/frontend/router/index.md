---
id: zero.frontend.router.index
type: index
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: index
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# File Routes With Explicit Server Authority

[Frontend index](../index.md) · [Documentation index](../../index.md)

Zero combines app/ file routes, nested layouts, server loaders and browser
navigation. Files describe composition; Guardian/server policies decide access.
Browser navigation and prefetched modules are not authorization.

## Guides

- [Configuration](./configuration.md): route/app/provider options and defaults.
- [File routes](./file-routes.md): page/layout/API/not-found conventions.
- [Segments and groups](./segments-and-groups.md): dynamic/catch-all/URL-less layouts.
- [Loaders and validation](./loaders-and-validation.md): trusted server preparation.
- [Authentication](./authentication.md): inherited server access and client signals.
- [Provider and hooks](./provider-and-hooks.md): pathname/params/history composition.
- [Navigation](./navigation.md): Link, native browser behavior and advanced manifests.
- [Rendering and hydration](./rendering-and-hydration.md): server/client boundaries.
- [Revalidation](./revalidation.md): deliberate anonymous cache behavior.
- [Sitemap](./sitemap.md): public discovery and explicit dynamic entries.
- [Roadmap](./roadmap.md): known ideas separate from current route contracts.

The inspected philosophy is convention-based structure with explicit, monotonic
server authority. Prefer managed createApp/AppProvider composition; low-level
route registration/hydration is advanced application-owned wiring.
