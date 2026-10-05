---
id: zero.frontend.router.configuration
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: configuration
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

# Routing Configuration

[Router index](./index.md) · [Documentation index](../../index.md)

Managed createApp selects appDir/outDir and routeAuth/publicPaths/loginPath/
postLoginPath/sitemap. The exact server settings live in
[application routing configuration](../../backend/configuration/routing.md).
AppProvider inherits server-injected values unless explicitly supplied and
validated; its [configuration](../runtime/configuration.md) is not a separate
server policy.

RouteConfig is exported from the browser-safe root/React barrel as a type.
A module's config.auth is an AccessRequirement; omission follows inherited/global
policy. config.revalidate is seconds (0 means no ISR cache).
config.middleware is a LoaderContext callback returning void or Response
(synchronous or promised). Layout middleware runs for pages, not implicitly
for API methods; route.ts declares its own middleware.

RouteModule.validate.params accepts a Valibot schema before loader/render.
RouteValidation is source-declared but not a named public barrel type; use
RouteModule['validate'] or an inferred declaration instead of private imports.
meta is PageMeta or a parameter-to-PageMeta function.

RouterProvider props are initialPathname/initialParams/children. Its Props type is
not automatically a named root export. Link props are href/children, replace=false,
prefetch='none' plus anchor attributes. Exact behavior belongs to
[navigation](./navigation.md), not a rewritten generic anchor contract.

These settings have different read times: app configuration resolves at managed
startup/build; module policy executes as trusted route code; hooks/Link props
run in React. Importing config/loader modules can execute application code.
Doctor does not simulate every browser route or approve arbitrary module side effects.

## Related Guides And Next Steps

- [Authentication](./authentication.md) owns policy inheritance.
- [Loaders](./loaders-and-validation.md) owns request/parameter preparation.
- [Provider](./provider-and-hooks.md) owns browser context.
- [Revalidation](./revalidation.md) owns cache admission.
