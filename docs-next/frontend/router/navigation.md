---
id: zero.frontend.router.navigation
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: navigation
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

# Link, Native Behavior And Route Prefetch

[Router index](./index.md) · [Documentation index](../../index.md)

```tsx
import { Link } from '@zero/framework/react';

<Link href="/tasks" prefetch="intent">Tasks</Link>;
```

Use under the normal RouterProvider/AppProvider. Required href/children plus
anchor attributes form LinkProps. replace defaults false; prefetch accepts
none(default), intent(hover) or render(effect after mount).

Local same-origin HTTP(S) left-clicks without modifiers update history.
User onClick runs first and can prevent navigation. Modified/non-left clicks,
non-self targets, downloads, external/protocol-relative external URLs and
non-HTTP schemes preserve native behavior. Query/hash remain the navigation URL;
prefetch uses normalized pathname keys instead of raw query/hash strings.
Changing href updates prefetch intent; native downloads/targets are not prefetched.
Render prefetch is SSR-safe because it happens in an effect.

Prefetch loads the route module/layouts into browser cache, not protected records,
server permission admission or a guaranteed successful page transition.
Do not store secrets in browser-importable route modules.

Advanced root/React exports are registerRoute(pattern,load,layouts=[]),
matchClientRoute(pathname), navigateTo(pathname) and prefetchRoute(pathname).
A client route loads a default component and layout modules. navigateTo returns
loaded module/layouts/params/route or null; it does not itself update history.
Managed generated manifests normally register these routes; app code should not
duplicate registration or import internal module-cache/scanner helpers.

Async navigation is generation-fenced: old module completion cannot replace a
newer route, redirect after unmount or trigger the wrong fallback. Missing client
routes use the committed full URL for a server reload, preserving query/hash.
Those are corrected development contracts documented in
[runtime hydration](../runtime/hydration.md).

## Verification

Check default/render/intent prefetch, changed href, query/hash, prevented/modified/
target/download/external links and overlapping route loads. An in-memory synthetic
browser regression supports the source correction; actual app styling/a11y and
package behavior must be independently qualified.

## Related Guides And Next Steps

- [Provider hooks](./provider-and-hooks.md) owns history state.
- [Rendering](./rendering-and-hydration.md) owns generated manifest/lifecycle.
- [Authentication](./authentication.md) owns server admission.
- [File routes](./file-routes.md) is the ordinary module convention.
