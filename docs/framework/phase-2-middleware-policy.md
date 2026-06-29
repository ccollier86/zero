# Phase 2: Middleware Matchers And Policy

Status: implemented

Phase 1 gave package-mode apps a Zero-native middleware declaration and a
scoped app-owned extension bundle. Phase 2 makes that middleware useful for
real app security and routing policy by adding structured matchers for path,
method, auth, role, and configured user properties.

This phase adds a reusable policy/matcher core that later resource, action,
workflow, and frontend gate work can share. It is not a
one-off middleware-only implementation.

## Goals

1. Add structured `matcher` support to `defineMiddleware()`.
2. Keep Phase 1 `path` and `auth` fields working as compatibility aliases.
3. Support safe path and method targeting without leaking middleware into Zero
   platform routes.
4. Enforce auth, role, and user-property requirements server-side.
5. Use the existing auth user property system rather than inventing a second
   metadata store.
6. Extract matcher/policy evaluation into focused server modules for later
   reuse by resources and actions.
7. Document the policy semantics clearly enough that app authors and AI agents
   can wire protected app areas without guessing.

## Non-Goals

These remain for later phases unless they are required to keep Phase 2 safe:

1. Full resource CRUD policy generation.
2. Frontend `PropertyGate` or route-guard components.
3. Doctor checks for every invalid matcher pattern.
4. A large role/permission engine.
5. Tenant-aware authorization.
6. Persistent audit logging for every policy decision.
7. `next()` middleware chaining semantics. Zero middleware still runs through
   Elysia `beforeHandle`; returning `undefined` continues, returning a response
   short-circuits.

## Existing Auth Property Support

Zero already supports configured user key/value properties:

```ts
auth: {
  registration: { mode: 'admin-only' },
  userProperties: {
    department: {
      type: 'enum',
      values: ['accounting', 'operations'],
      default: 'operations',
      editableBy: 'admin',
      useInPolicies: true,
    },
    notificationsEnabled: {
      type: 'boolean',
      default: true,
      editableBy: 'user',
    },
  },
}
```

Defaults are applied when users are created through public/bootstrap
registration and admin-created accounts. Middleware property matchers use this
existing property store. There is no second middleware-specific metadata
store.

## Public API

### Preferred Middleware Shape

```ts
import { defineMiddleware } from '@zero/framework/server';

export default defineMiddleware({
  name: 'accounting-area',
  matcher: {
    path: '/accounting/:path*',
    method: ['GET', 'POST'],
    auth: 'user',
    role: ['admin', 'manager'],
    properties: {
      department: ['accounting', 'management'],
    },
  },
  run({ request, user, zero }) {
    zero.observability.emitEvent({
      level: 'info',
      category: 'app.audit',
      code: 'APP_ACCOUNTING_ACCESS',
      message: 'Accounting area accessed.',
      metadata: {
        path: new URL(request.url).pathname,
        userId: user.userId,
      },
    });
  },
});
```

### Compatibility Shape

Phase 1 style remains valid:

```ts
defineMiddleware({
  name: 'legacy-audit',
  path: '/api/*',
  auth: 'user',
  run() {},
});
```

Internally this should normalize to:

```ts
matcher: {
  path: '/api/*',
  auth: 'user',
}
```

## Matcher Contract

Public matcher types are exported from `@zero/framework/server`:

```ts
type ZeroMiddlewareMatcher = {
  path?: ZeroPathMatcher | ZeroPathMatcher[];
  method?: ZeroHttpMethodInput | ZeroHttpMethodInput[];
  auth?: false | 'optional' | 'user' | 'admin';
  role?: string | string[];
  properties?: Record<string, ZeroPropertyRequirement>;
  predicate?: (context: ZeroMatcherContext) => MaybePromise<boolean>;
};

type ZeroPathMatcher =
  | string
  | RegExp
  | ((context: ZeroMatcherContext) => MaybePromise<boolean>);

type ZeroPropertyRequirement =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | {
      equals?: string | number | boolean;
      in?: Array<string | number | boolean>;
      not?: string | number | boolean | Array<string | number | boolean>;
      exists?: boolean;
    };
```

## Path Semantics

Supported string patterns:

| Pattern | Meaning |
| --- | --- |
| `/api/customers` | Exact path. |
| `/api/*` | Prefix match for `/api/`. |
| `/api/:path*` | Prefix/rest match for `/api/`. |
| `/users/:userId` | Single path segment parameter. |
| `*` or `/*` | Any path in the app-owned extension bundle. |

Path matching is deterministic and local; it does not add a route-matching
dependency.

## Policy Semantics

Matcher evaluation has two stages:

1. Applicability: `path`, `method`, and `predicate`.
2. Authorization requirements: `auth`, `role`, and `properties`.

If applicability fails, middleware does not run and the request continues.

If applicability passes but authorization requirements fail, the request is
rejected:

| Failure | Status |
| --- | --- |
| Missing/invalid auth for `auth: 'user'`, `auth: 'admin'`, role, or properties | `401` |
| Authenticated user lacks required role | `403` |
| Authenticated user lacks required property/value | `403` |
| Property policy requires auth while auth plugin is unavailable | `401` |

`role` and `properties` imply `auth: 'user'` even when `auth` is omitted.
`auth: 'admin'` remains equivalent to requiring an authenticated user with
admin role.

Zero maps middleware policy denials to JSON auth errors inside the app-owned
extension bundle:

```json
{ "error": "Unauthorized", "code": "UNAUTHORIZED" }
```

```json
{ "error": "Forbidden", "code": "FORBIDDEN" }
```

## Implementation Slices

### Slice 1: Extract Matcher Types And Normalization

Add a focused matcher module:

```txt
src/frontend/server/server-matcher.ts
```

Responsibilities:

1. Define matcher/path/property types.
2. Normalize legacy `path`/`auth` fields into `matcher`.
3. Compile string path patterns.
4. Evaluate path, method, and predicate applicability.
5. Return structured results with clear failure reasons for callers.

This module must not import Elysia, mutate app state, or load auth stores.

### Slice 2: Add Server Policy Evaluation

Add a focused policy module:

```txt
src/frontend/server/server-policy.ts
```

Responsibilities:

1. Decide effective auth from matcher auth/role/properties.
2. Enforce auth and role using `AuthContext`.
3. Load user properties lazily through `getAuthStore()` only when a property
   requirement exists.
4. Compare property values using the same serialized value convention as
   `UserPropertyService`.
5. Return a structured allow/deny result that `server-extensions.ts` can turn
   into `AuthError`.

This module should not know about filesystem loading or Elysia route
registration.

### Slice 3: Wire `defineMiddleware()`

Update `server-extensions.ts`:

1. Add `matcher?: ZeroMiddlewareMatcher` to middleware options.
2. Preserve existing `path` and `auth` options.
3. Normalize once during `defineMiddleware()`.
4. In `applyMiddleware()`, run applicability first.
5. Enforce authorization before `run()`.
6. Expose non-null `user` typing when middleware declares `auth: 'user'`,
   `auth: 'admin'`, `role`, or `properties` in its own matcher.

### Slice 4: Observability And Errors

Use existing auth errors for denied requests:

1. `AuthError('Unauthorized', 'UNAUTHORIZED', 401)`.
2. `AuthError('Forbidden', 'FORBIDDEN', 403)`.

Do not emit noisy observability events for every normal deny by default.
Emit stable observability codes only for configuration/runtime problems such as
property checks requiring auth services that are unavailable.

Stable observability codes:

1. `ROUTER_MIDDLEWARE_MATCHER_INVALID`
2. `ROUTER_MIDDLEWARE_POLICY_AUTH_UNAVAILABLE`

### Slice 5: Tests

Add focused tests for:

1. Exact, prefix, `:path*`, and parameter path matching.
2. Method matching.
3. Predicate matching.
4. Legacy `path` and `auth` aliases.
5. `auth: 'user'` allows authenticated users and rejects anonymous requests.
6. `auth: 'admin'` allows admins and rejects non-admin users.
7. `role` arrays allow matching roles and reject non-matching roles.
8. Property equality/in/not/exists checks.
9. Property checks use configured/default user properties on created users.
10. Middleware still does not leak into parent/platform routes.
11. Raw Elysia route compatibility remains intact.

### Slice 6: Docs And Examples

Update:

1. `docs/framework/phase-2-middleware-policy.md`
2. `docs/framework/api-standardization-plan.md`
3. `docs/framework-developer-surface.md`
4. `docs/start-here.md` if generated-app guidance changes
5. `examples/package-mode` if a concise middleware example helps

## File Responsibility Plan

| File | Responsibility |
| --- | --- |
| `server-matcher.ts` | Matcher types, normalization, path/method/predicate applicability. |
| `server-policy.ts` | Auth, role, and property policy evaluation. |
| `server-extensions.ts` | Definition API and Elysia application only. |
| `server-route-loader.ts` | Filesystem loading only; should not gain policy logic. |
| `auth/*` | Existing user property config, defaults, and persistence. Only add getters if policy evaluation needs them. |

## Security Notes

1. Policy checks must run on the server before app handlers.
2. Property checks must not trust client-provided state.
3. Role/property requirements imply authentication.
4. Missing auth services should fail closed.
5. Middleware applicability must not silently bypass authorization once a path
   and method match.
6. Raw Elysia remains possible, but docs should steer common protected routes
   through Zero middleware or endpoint auth.

## Acceptance Criteria

- [x] `defineMiddleware()` accepts structured `matcher`.
- [x] Existing `path` and `auth` middleware fields still work.
- [x] Path/method applicability and auth/role/property authorization are
  separate and tested.
- [x] Property checks use existing auth user properties.
- [x] Protected matchers fail closed when auth is missing or insufficient.
- [x] Middleware remains scoped to app-owned extension routes.
- [x] Matcher/policy logic is split out of `server-extensions.ts`.
- [x] Docs and examples explain matcher semantics.
- [x] Obsiian phase tracking is updated.
