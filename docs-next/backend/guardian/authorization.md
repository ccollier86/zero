---
id: zero.guardian.authorization
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: declarative-access-requirements
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Declare And Enforce Access

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian uses one transport-neutral access vocabulary across managed HTTP
routes, resources and authorization helpers. Declare the requirement where
the operation is admitted; use the resulting authority-scoped services for
its domain work. UI visibility is a convenience, not the enforcement boundary.

## The Simple Contract Still Exists

`AccessRequirement` accepts the compatibility forms:

| Value | Admission |
| --- | --- |
| `false`, `'optional'` | No required identity; an admitted identity may still be available. |
| `true`, `'user'`, `'required'` | Require authenticated identity. |
| `'admin'` | Require the current global/platform role `admin`. |

In multi mode, do not use the global `admin` label as a substitute for live
Administration Organization permission checks. For app and platform operations,
prefer explicit permission requirements tied to their correct scopes.

## Structured Requirements

```ts
import type { AccessRequirement } from '@zero/framework/auth';

const mayEditDocuments = {
  user: 'required',
  tenant: 'required',
  permission: 'documents:write',
  credentials: ['session', 'api-key'],
} satisfies AccessRequirement;
```

Declare `documents:write` in the authorization registry before compiling this
requirement. `tenant: 'required'` is a multi-mode requirement and is rejected
under single-mode compilation.

| Field | Meaning |
| --- | --- |
| `user` | `required` or `optional`; role/permission/property requirements imply authentication. |
| `credentials` | Explicit admitted credential classes: session and/or api-key. |
| `platformRole` | Global identity role(s), not organization roles. |
| `tenant` | Require a valid selected tenant scope. |
| `scopeRole` | Application role in single mode; selected tenant role in multi mode. |
| `permission` | One required declared permission. |
| `allPermissions` | Every permission in the list is required. |
| `anyPermissions` | At least one listed permission is required. |
| `properties` | Required predicates on declared, trusted user properties. |

An array of role names is OR within that role group. Separate inherited groups
are AND. A trusted property predicate may be a scalar, allowed-value array, or
an object with `equals`, `in`, `not` and/or `exists`.
[User properties](./user-properties.md) defines which fields are trustworthy.

Omitted credential admission preserves the session-only default.
Enabling API keys globally does not automatically let keys access every route.

## Managed Endpoint Example

```ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  name: 'documents.rename',
  method: 'POST',
  path: '/api/documents/rename',
  auth: {
    tenant: 'required',
    permission: 'documents:write',
    credentials: ['session', 'api-key'],
  },
  body: t.Object({
    documentId: t.String(),
    title: t.String({ minLength: 1, maxLength: 200 }),
  }),
  async handler({ body, zero }) {
    // Use the request's scoped services and the app's resource/domain policy.
    // The path's permission admission does not replace row ownership checks.
    return { accepted: true, documentId: body.documentId, title: body.title };
  },
});
```

This minimal example demonstrates admission; an actual write must call the
application's admitted service/resource operation. See
[managed endpoints](../runtime/endpoints.md) and
[service boundaries](../../concepts/service-boundaries.md) for service injection.
Do not turn this into a raw SQL bypass merely because the endpoint has an
`auth` declaration.

## Parent And Child Rules Are Monotonic

Managed route groups compile parent and child requirements conjunctively.
A child can add constraints; it cannot turn off its parent's authentication,
tenant, role, permission or trusted-property requirements with `auth: false`.

Credential constraints also remain a real admission boundary. Explicitly
design where machine credentials are admitted rather than treating a child
route as a way to widen an ancestor's session-only rule.

Unknown fields, undeclared permissions/roles, invalid tenant requirements and
untrusted property requirements fail configuration/compilation. They do not
silently produce “allow all” policies.

## Scopes And Permission Evaluation

Permissions declare `scope: 'application'` or `scope: 'tenant'`.
The default scope is application in single mode and tenant in multi mode.

In multi mode the active tenant scope authorizes ordinary workspace work.
A separate application authority projection exists only through a live
Administration membership with application permissions. Owning a customer
organization confers all permissions inside that organization, not platform
powers or access to another organization's data.

Holding both app and platform roles does not merge all organization databases
into one visible data realm. Data scope remains a server-admitted binding.

## Pure Kernel Versus Live Request Resolution

Public `AuthorizationKernel`/`createAuthorizationKernel()` compile and
evaluate immutable snapshots. `evaluate()` returns an allowed/denied decision;
`authorize()` throws the stable AuthError for denial.

They do not load users, verify tokens, refresh memberships or own request
lifecycle. Fabricating a snapshot and passing it to the pure kernel does not
establish trusted request authority. Managed middleware resolves live state
first and keeps service operations commit-fenced where required.

For custom Elysia composition, use the public auth plugin/middleware with
app-local runtime getters and named dependency composition. Do not rely on a
process-global “current user” or duplicate transport/tenant policy in each
handler.

## Error And Verification Contract

Denial reasons distinguish authentication, credential class, platform role,
missing/invalid scope, tenant, scope role, permission and trusted property.
Present safe auth errors; preserve stable codes for diagnostics instead of
replacing all denial responses with an unrelated generic server exception.

Verify public/required identity, parent inheritance, wrong credential class,
undeclared configuration, trusted-property checks, customer owner ceilings,
Administration app-only roles and live role revocation. Reuse the same
requirement at every exposed operation, not only the visible button.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [RBAC](./rbac.md) declares roles, assignment ceilings and protected owners.
- [Control plane](./control-plane.md) separates platform and workspace authority.
- [API keys](./api-keys.md) explains explicit machine credential admission.
- [Runtime middleware](../runtime/middleware.md) explains Elysia integration.
