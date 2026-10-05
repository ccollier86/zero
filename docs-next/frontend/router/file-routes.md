---
id: zero.frontend.router.file-routes
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: file-routes
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

# Pages, Layouts, API Methods And Not Found

[Router index](./index.md) · [Documentation index](../../index.md)

The managed appDir defaults to app. Files are executable application modules,
not configuration data parsed in a sandbox.

| File | Contract |
| --- | --- |
| page.tsx | default React page; optional loader/meta/validate/config |
| layout.tsx | default React layout wrapping children; optional config |
| route.ts | named GET/POST/PUT/DELETE/PATCH handlers; optional config |
| not-found.tsx | default nearest not-found component |

Layouts compose root-to-leaf. A page and API module can occupy the same segment;
method matching selects the API handler when present. Do not infer API protection
from the visual page alone: declare route access/middleware.

```tsx
// app/tasks/page.tsx
export default function TasksPage() {
  return <main><h1>Tasks</h1></main>;
}
```

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
```

These minimal files illustrate composition; they assume managed server/router
setup and do not bypass the app's protected-by-default policy.

API handlers receive LoaderContext (params/request/auth/access/redirect) and
return Response or Promise<Response>. They are not generic Elysia Context.
Prefer the integrated [endpoint/router system](../../backend/runtime/routers.md)
for typed request service composition and domain policies. A file API can call
app-owned services after explicit access admission; do not pass whole context
into business services.

Unknown/invalid paths use the closest not-found component or generated404.
Module/loader/render failures are distinct from ordinary misses and emit through
Zero's render-error boundary. Public render details vary with the qualified
production bundle; never intentionally return raw private stacks.

## Related Guides And Next Steps

- [Segments](./segments-and-groups.md) owns URL matching.
- [Loaders](./loaders-and-validation.md) owns prepared page data.
- [Authentication](./authentication.md) owns access/middleware.
- [Runtime routers](../../backend/runtime/routers.md) owns typed service routes.
