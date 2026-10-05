---
id: zero.guardian.integration
type: architecture
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: elysia-plugin-and-managed-service-integration
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

# Integrate Guardian Across The Application

[Guardian index](./index.md) · [Documentation index](../../index.md)

Managed Zero composition owns Guardian's app-local runtime, system tables,
middleware and service projections. Reuse those boundaries across HTTP,
Sync and background work. Do not build a parallel token store because a
particular UI, plugin or machine endpoint uses a different transport.

## Managed Composition

`createApp({ auth: true })` enables the single/simple profile.
An auth object selects the explicit policy; omitted/false disables Guardian.
The managed runtime mounts auth against the system database, injects the app's
email/platform-token dependencies, and mounts named Elysia middleware before
application routes.

Managed endpoints declare `auth`; managed resources declare their access and
domain policies. The injected request `zero` services bind data/storage/
workflow operations to admitted authority and scope. Trusted setup services
and request services are different capability bags.

[Runtime composition](../runtime/composition.md),
[plugins](../runtime/plugins.md) and
[request services](../runtime/server-services.md) own that integration contract.

## Direct Elysia Composition

Advanced standalone composition may use the public auth exports with a
caller-owned ReactiveDB and app-local runtime getters:

```ts
import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  createAuthMiddleware,
  type AuthRuntime,
} from '@zero/framework/auth';
import type { ReactiveDB } from '@zero/framework/sync';

// Trusted composition fragment; the caller owns DB lifecycle and email setup.
export function withGuardian(db: ReactiveDB) {
  let runtime: AuthRuntime | undefined;
  const app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: 'disabled',
    onRuntimeCreated(created) { runtime = created; },
  }));
  return app.use(createAuthMiddleware(
    () => runtime?.getTokenService() ?? null,
    {
      getRequestCredentialResolver: () => runtime?.getRequestCredentialResolver() ?? null,
      getAuthorizationKernel: () => runtime?.getAuthorizationKernel() ?? null,
      getPropertyStore: () => runtime?.getStore() ?? null,
      getRoleAssignments: () => runtime?.getAuthorizationRoleService() ?? null,
    },
  )).get('/private', ({ requireAuth }) => {
    const user = requireAuth();
    return { userId: user.userId };
  }, { zeroAuth: 'user' });
}
```

This is a composition fragment, not an account-provisioned runnable server.
Bootstrap-disabled requires a deliberate supported provisioning policy before
someone can log in. Standalone composition does not reproduce managed Fabric/
system-plane setup merely by giving auth an arbitrary app database.

Global compatibility getters exist, but app-local runtime getters avoid coupling
two apps composed in one process. Named plugins and resolve propagation give
Elysia proper service typing/deduplication; do not replace them with ad hoc
casts to a request-global user.

## Multipart And Early Admission

Elysia body parsing normally precedes resolve/beforeHandle. Managed protected
multipart endpoints install an on-request auth guard before consuming files.
Raw Elysia routes must deliberately install
`createProtectedMultipartRequestGuard()` and their normal `zeroAuth` rule
when equivalent early rejection is required.

Bearer hydration is cached per Request and app-local credential resolver so
nested plugins share the lookup without cross-app identity coupling.
Public multipart routes remain public; preloading alone does not make a route
protected. The required guard must have the correct method/path/access policy.

## Read Authorization Hints Safely

`GET /auth/authorization` returns the current browser-safe authorization
snapshot, rehydrated from live identity and retained role assignments.
It intentionally omits trusted policy-property values and raw authentication
proofs. UI role/permission gates can consume hints, but the server must still
enforce the actual operation.

Client readiness retires data on user, tenant and authority-generation
transitions. A public signed-out page must remain usable after anonymous sync
reset; “restoring” cannot be an indefinite substitute for an unauthenticated
state. [Sessions](./sessions.md) owns that distinction.

## Sync And Background Operations

Sync admission must use current Guardian authority, tenant/resource row filters,
and lifecycle cleanup for the stable underlying Bun socket. An already
authenticated socket is not allowed to retain revoked scope forever.

Background work must persist secret-free execution/authority references rather
than raw bearer/refresh credentials. Reconstruct current scope and revalidate
both asynchronous and synchronous commit boundaries through the supported
[verified machine projection](../runtime/machine-services.md) or the background
system's execution service boundary.

App-specific HMAC/MCP/mTLS verification remains the app's credential adapter.
Guardian user keys do not automatically implement those proof protocols.

## Lifecycle And Failure

Startup/readiness must finish before admitting auth routes; stale runtime
profile generations fail closed. On shutdown, extensions drain admitted work
before Guardian/Fabric disposal, then credential/outbox/runtime cleanup runs
under the managed stop sequence. Use [shutdown](../runtime/shutdown.md) for
extension drain semantics rather than registering detached promises.

Configuration errors are not request-auth failures. Unavailable runtime,
stale authority and domain denial have distinct safe codes;
[errors and observability](./errors.md) describes presentation and recording.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Authorization](./authorization.md) supplies the common declarative vocabulary.
- [Identity projection](./identity-projection.md) bridges canonical identity to app FKs.
- [Runtime lifecycle](../runtime/lifecycle.md) owns startup/extension lifetimes.
- [Machine services](../runtime/machine-services.md) binds verified non-browser work.
