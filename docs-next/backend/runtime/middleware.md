---
id: zero.runtime.middleware
type: how-to
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: middleware
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

# Middleware: Match First, Then Enforce

[Runtime index](./index.md) · [Documentation index](../../index.md)

`defineMiddleware` adds named cross-cutting behavior to matching app-owned
extension routes. Applicability and authorization are different decisions:
a request that does not match is skipped; a matching request must satisfy the
declared policy before the callback runs.

```ts
import { defineMiddleware } from '@zero/framework/server';

export default defineMiddleware({
  name: 'example.write-boundary',
  auth: 'user',
  matcher: { path: '/api/example/*', method: ['POST', 'PATCH'] },
  run({ user }) {
    // Delegate a shared domain rule here; the admitted identity is available.
    // Do not verify a second JWT or open a caller-selected database file.
    void user.userId;
  },
});
```

This is a composition fragment, not a new data permission. Individual endpoints
must still declare/enforce their own required feature access.

## Matcher Contract

`matcher.path` accepts a string, RegExp, trusted predicate or array of those.
`method` accepts a supported method or array and normalizes case. `predicate`
may be async. These fields decide applicability. A path callback receives a
minimal request context; it is trusted application code, not a browser policy.

`matcher.auth`, `role` and `properties` are enforcement requirements, not
skip-if-unauthorized filters. Properties support equals/in/not/exists patterns
over declared scalar values; a client-supplied property is not canonical identity
metadata. `role` refers to the actual matcher policy semantics, not arbitrary
tenant display names.

The top-level `path` is a legacy alias. Explicit structured matcher fields win
over the corresponding aliases. Omit matching conditions to apply broadly
within the composed app-owned extension boundary; do not assume a middleware
file intercepts every built-in Zero route.

## Admission Is Request-Local

The middleware's merged access is admitted before run. A callback may return an
early response or finish asynchronously. The compiler resets optional credential
visibility afterward so descendants must establish their own policy; a key
admitted for one middleware must not become implicitly visible to every route.

Use the scoped context and shared authorization API. A raw app-global database,
token store or compatible getter is not a safer shortcut for a tenant operation.
See [service boundaries](../../concepts/service-boundaries.md).

## Verification And Failure

Test nonmatching paths/methods (callback absent), matching authorized requests
(callback runs), matching unauthorized requests (denied, not skipped), and custom
predicate rejection/error. Avoid predicates with hidden external side effects.
Do not swallow a failed guard and continue to the domain handler.

## Related Guides And Next Steps

- [Routers](./routers.md) supplies inherited policy and scoped composition.
- [Endpoints](./endpoints.md) owns the final route's request validation/access.
- [Plugins](./plugins.md) handles reusable dependency setup.
- [Configuration](./configuration.md#middleware-options) lists exact matcher fields.
