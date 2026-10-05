---
id: zero.frontend.router.loaders-and-validation
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: loaders-and-validation
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

# Server Loaders And Validated Parameters

[Router index](./index.md) · [Documentation index](../../index.md)

A page loader runs on the server before rendering. Its ordinary result becomes
page data; returning Response short-circuits rendering (for example redirect).
The server access/middleware boundary runs before protected preparation.

```tsx
// app/tasks/[taskId]/page.tsx
import * as v from 'valibot';
import type { LoaderContext, RouteModule } from '@zero/framework/react';

export const validate = {
  params: v.object({ taskId: v.pipe(v.string(), v.minLength(1)) }),
} satisfies NonNullable<RouteModule['validate']>;

export function loader({ params }: LoaderContext) {
  return { title: `Task ${params.taskId}` };
}

export default function TaskPage({ data }: { data: { title: string } }) {
  return <h1>{data.title}</h1>;
}
```

This synthetic page has no database access. Its app's normal policy still
applies. Add your declared service/resource admission before fetching real data.

LoaderContext exposes params, request, optional auth, access and
redirect(url,status=302). auth is live Bearer identity or the page-only session;
access is the canonical request-local facade. Page cookies are not a substitute
for Bearer admission on file API handlers. Redirect returns Response; validate
any caller-supplied destination through the appropriate app policy.

validate.params uses Valibot safe parsing before loader/component. Failure is an
ordinary404/not-found result, not500 and not a query against invalid parameters.
Do not assume validation transforms replace every matched parameter: the contract
is admission, and app code should use typed/domain-safe values deliberately.

meta accepts title/description and other supported metadata values, either static
or params-based. Do not inject secrets into metadata/loader results: client-route
loader data can be serialized into the browser shell. Server execution alone
does not make its return value private.

Layout config.middleware runs before page preparation; route.ts middleware
protects its own API handler. A Response can short-circuit. Services receive small
explicit values, not the whole LoaderContext. Long-running effects should use
managed domain services/Torrent rather than depend on a page-render lifetime.

## Related Guides And Next Steps

- [Authentication](./authentication.md) owns identity/access.
- [Rendering](./rendering-and-hydration.md) explains serialized browser data.
- [Runtime services](../../backend/runtime/server-services.md) owns service composition.
- [File routes](./file-routes.md) owns module exports.
