---
id: zero.runtime.routers
type: how-to
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: routers
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Named Routers And Inherited Access

[Runtime index](./index.md) · [Documentation index](../../index.md)

Use `defineRouter` for a named group with a shared URL prefix and access
requirement. Child endpoints inherit that boundary; child policy adds to the
inherited requirement rather than silently turning a protected subtree public.

```ts
import { defineEndpoint, defineRouter } from '@zero/framework/server';

export default defineRouter({
  name: 'example.workspace',
  prefix: '/api/workspace',
  auth: 'user',
  routes: [
    defineEndpoint({
      method: 'GET', path: '/status',
      handler({ user }) { return { userId: user?.userId }; },
    }),
  ],
});
```

The mounted path is `/api/workspace/status`. In this fragment the enclosing
policy guarantees admission at runtime; the child definition's own generic
user type may remain optional because its standalone declaration omitted auth.
Use an explicit child auth requirement when its local TypeScript narrowing is
needed—do not use a non-null cast to imply a runtime guard.

## Shape And Order

`name` is required and participates in named Elysia plugin deduplication.
`prefix` is optional. `auth` is optional. `endpoints` and `routes` are naming
aliases for child arrays; when both are supplied, endpoints precede routes.
Choose one for clarity rather than registering a child twice through both.

Children may be endpoints, middleware, nested routers, Zero plugins or raw
Elysia plugin/callback inputs. Nested prefixes compose. Names and paths must be
valid at declaration time; constructing the router does not open a listener.

## Access Is Not A Matcher

Inherited Guardian requirements govern the subgroup, including its raw route
plugins. A child cannot use a UI-hidden flag or optional auth to bypass a parent
permission. Place deliberately public endpoints in an appropriately public
group. A contradictory anonymous/protected combination is not a safe login-route
workaround.

Raw app-owned handlers still own their domain checks. Use scoped request services
and declare any extra permission needed to read/modify an application feature;
the router's user requirement alone is not record ownership.

## Lower-Level Composition

`createServerRoute` creates an app-aware named route plugin. For ordinary grouped
declarations, prefer defineRouter plus managed discovery. Public extension
composition helpers can build/apply bundles with explicit app-local runtime
bindings; they do not make an arbitrary Elysia plugin safe by type alone.

## Verification And Next Steps

Test a nested mounted URL, denied anonymous request, denied missing child grant
and accepted actor. Verify raw child routes retain the group's required boundary.
Use unique meaningful router names, not randomly generated names that defeat
deduplication or overload traces.

- [Endpoints](./endpoints.md) owns schemas and handler context.
- [Middleware](./middleware.md) separates applicability from enforcement.
- [Discovery](./discovery.md) owns export normalization/load order.
- [Configuration](./configuration.md#router-options) lists exact group options.
