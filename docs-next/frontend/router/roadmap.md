---
id: zero.frontend.router.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: roadmap
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

# Router Roadmap

[Router index](./index.md) · [Documentation index](../../index.md)

Future-facing directions include better Markdown-first documentation/public-content
tooling and onboarding/navigation catalogs. These are product ideas, not a new
routing language, arbitrary optional-catch-all API or generalized distributed cache.

Current file routes, nested/group layouts, loaders, parameter admission, Link
prefetch/native behavior, auth inheritance and sitemap already have detailed homes.
Confirmed defects in those contracts are corrected/tested before publication;
they are not repackaged as roadmap limitations.

## Related Guides And Next Steps

- [File routes](./file-routes.md) owns existing conventions.
- [Navigation](./navigation.md) owns the ordinary browser interface.
- [Configuration](./configuration.md) owns current settings.
