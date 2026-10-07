---
id: zero.frontend.router.revalidation
type: reference
audience: [developer, agent]
owner: frontend-router
status: verified
visibility: internal
system: frontend-router
feature: revalidation
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "554caea1e5570ab4f52d3f4f82b2d75e004fbf7e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Deliberate Anonymous Route Caching

[Router index](./index.md) · [Documentation index](../../index.md)

RouteConfig.revalidate sets a positive seconds lifetime for eligible anonymous
GET HTML. Zero's cache is app-router-local memory, not a durable distributed ISR
service or an app database subscription.

```ts
import type { RouteConfig } from '@zero/framework/react';

export const config = { auth: false, revalidate: 60 } satisfies RouteConfig;
```

This module fragment is useful only for a genuinely public route; auth=false
cannot weaken a protected inherited requirement. Omitted/zero revalidate means
no cache. Cache keys include origin, pathname and search, not only a route pattern.

Cache admission excludes requests with Authorization or Cookie headers, live page
identity or a presented ambient page credential, even when invalid. A rejected
safe document does not delete cookies by name; that restriction must not turn it
into shared public content. Access/middleware is evaluated
before cache use. Authenticated/rejected-session responses remain private;
a cached anonymous shell cannot replace a user's scoped page.
Only successful200 render responses enter the cache. A fresh hit sends X-Cache=HIT
and s-maxage/stale-while-revalidate headers. Expired entries render again.

Do not read private records in a supposedly anonymous loader and assume route
cache will fix authorization. A positive revalidate setting is not a browser
collection freshness interval, Sync subscription or durable refresh job.
Changing app/module config normally requires the managed runtime/build restart;
internal renderer cache invalidation is not a supported app-facing API.

## Verification

Use different origins/query strings, cookie/Bearer requests, authenticated users,
rejected sessions and public anonymous calls. Confirm no shared private loader data
and expected hit/lifetime behavior. Source-isolation regressions do not qualify
an external CDN or distributed deployment cache.

## Related Guides And Next Steps

- [Authentication](./authentication.md) owns public/private admission.
- [Loaders](./loaders-and-validation.md) owns cacheable data preparation.
- [Rendering](./rendering-and-hydration.md) owns response generation.
- [Configuration](./configuration.md) owns read time and app settings.
