---
id: zero.frontend.router.authentication
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: authentication
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

# Inherited Route Access And Public Entrances

[Router index](./index.md) · [Documentation index](../../index.md)

Auth-enabled apps default protected-by-default; authless apps default explicit.
In explicit mode route/layout declarations determine protection. Global publicPaths
makes designated page entrances reachable but does not weaken explicit inherited
requirements.

```ts
import type { RouteConfig } from '@zero/framework/react';

export const config = { auth: 'required' } satisfies RouteConfig;
```

This module fragment requires a user. Full AccessRequirement supports Guardian's
structured permissions/roles/properties/scope language; its authoritative contract
is [Guardian authorization](../../backend/guardian/authorization.md).

Layout requirements merge root-to-leaf monotonically. A child auth=false cannot
erase a parent's requirement. A group name is not policy. Colocated route.ts APIs
inherit layout access requirements, but layout middleware itself is page-oriented;
the API module must declare any needed custom middleware.

Pages may authenticate from the page-session cookie or Bearer. File API handlers
remain Bearer-authenticated. Signed-in visits to login follow validated redirect/
postLoginPath behavior; anonymous account pages remain reachable after session
reset. See [app routing settings](../../backend/configuration/routing.md).

Public helpers from the React/root barrel are isPublicPath, resolveRouteAuthMode,
normalizeRouteAuthRequirement, mergeRouteAuthRequirements and
shouldRequireAuthForRoute. isPublicPath uses exact/prefix admission, with '/'
matching only the root. Normalization/merge produce a reduced browser presentation
signal (false|required|admin), not the full server permission decision.

Browser gates/reset boundaries hide stale data and guide login; the server
revalidates access and scopes services. Administration membership alone grants
neither platform operations nor cross-organization app data. Avoid speculative
cookie/fabric selectors in custom browser guards.

## Verification

Exercise public bootstrap/login, authenticated refresh, rejected cookie cleanup,
layout strengthening, API Bearer-only behavior, app-only and mixed admin roles,
scope replacement and no stale cached loader response. Focused regression evidence
does not replace exact-package multi-mode qualification.

## Related Guides And Next Steps

- [Guardian authorization](../../backend/guardian/authorization.md) owns requirements.
- [AppProvider](../runtime/app-provider.md) owns public/authenticated display.
- [Revalidation](./revalidation.md) owns private cache exclusion.
- [Loaders](./loaders-and-validation.md) owns server preparation.
