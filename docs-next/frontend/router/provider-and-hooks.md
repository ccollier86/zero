---
id: zero.frontend.router.provider-and-hooks
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: provider-and-hooks
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

# Router Context And Hooks

[Router index](./index.md) · [Documentation index](../../index.md)

The root/React barrel exports RouterProvider, useRouter, usePathname and useParams.
Managed AppProvider reuses an existing provider or composes one for the app;
do not add a second routing tree just to access hooks.

```tsx
import { useParams, usePathname, useRouter } from '@zero/framework/react';

const params = useParams<{ taskId: string }>();
const pathname = usePathname();
const router = useRouter();
```

This fragment belongs in React under the managed provider.
useParams<T>() is a compile-time cast over current matched params, not runtime
validation. usePathname reports pathname only, not query/hash.

RouterProvider takes children and optional initialPathname/initialParams.
SSR defaults pathname '/' and empty params; browser state subscribes to popstate.
RouterActions exposes push/replace/back/prefetch, isNavigating, setParams and
setIsNavigating. The latter setters are advanced integration controls, not
permission or server-loader execution.

push/replace update same-origin browser history and dispatch popstate.
back delegates browser history. Pass normal admitted local paths; these raw
actions are not an external URL navigator. prefetch expects a registered route
pathname. [Link](./navigation.md) handles normal native/external semantics.
Hooks throw an actionable missing-provider error when called outside context.

The provider manages browser URL state; hydration/router runtime manages modules
and commit lifecycle. It does not fetch a server page merely by updating params,
persist a saved view, authenticate a user or run Elysia middleware in the browser.
No additional socket is opened.

## Related Guides And Next Steps

- [Navigation](./navigation.md) is the ordinary anchor interface.
- [Hydration](./rendering-and-hydration.md) owns module loading/commit fences.
- [Runtime provider](../runtime/app-provider.md) owns app composition.
- [Segments](./segments-and-groups.md) owns parameter conventions.
