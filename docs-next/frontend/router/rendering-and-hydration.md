---
id: zero.frontend.router.rendering-and-hydration
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: rendering-and-hydration
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

# Server Rendering And Client Boundaries

[Router index](./index.md) · [Documentation index](../../index.md)

A server page renders HTML through the managed renderer. A 'use client' directive
in the page or an ancestor layout crosses the client route boundary: the server
prepares a shell and serialized data/config; generated browser modules mount it.
This preserves one React module identity in package-mode apps.

Server loaders still execute before that shell. Returned data and injected
configuration must be browser-safe; server-owned credentials/services never belong
in loader serialization. SSR output is not an authorization boundary by itself:
page/API/server resource policies enforce access before preparation.

createApp manages client bundle/manifest/style setup. The advanced hydration
entry is @zero/framework/react/hydrate-runtime; its exact manifest/startHydration
contract lives in [runtime hydration](../runtime/hydration.md). Generated scanner/
renderer/module-cache helpers are not guessed public imports.

AppProvider composes client/router/error/modal integration; the server SSR branch
does not open a browser socket. Client hydration adopts injected data planes and
authorization boundaries rather than create an independently privileged selector.
Scope changes clear stale presentation; navigation module commits are generation/
unmount fenced.

Rendering failures emit through Zero's frontend/server observability boundaries.
Custom fallback UI must avoid private error details. Production bundler settings
and artifact verification matter before asserting stack stripping. Use client
components for interactive hooks, not side effects during server rendering.

## Related Guides And Next Steps

- [Runtime hydration](../runtime/hydration.md) owns the advanced entry/manifest.
- [AppProvider](../runtime/app-provider.md) owns normal composition.
- [Loaders](./loaders-and-validation.md) owns preparation/serialized data.
- [Revalidation](./revalidation.md) owns server HTML caching.
