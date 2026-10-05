---
id: zero.runtime.server-services
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: request-services
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Use Services At The Request Boundary

[Runtime index](./index.md) · [Documentation index](../../index.md)

A managed endpoint receives `zero: ServerRequestServices`. It is a live
request projection, not the same object as a plugin's privileged setup services.
Use this projection after [route admission](./endpoints.md), rather than importing
a global store or choosing a database from request input.

## Choose The Right Surface

| Context | Surface | Authority responsibility |
| --- | --- | --- |
| trusted plugin setup | `ServerRouteServices` | application code injects narrow dependencies and owns privileged work |
| admitted HTTP request | `ServerRequestServices` | route policy plus live actor/scope fences and service policies |
| verified machine/background work | `AuthorityScopedServerServices` | caller supplies verified binding and both live fences; no unsafe escape |

[Machine services](./machine-services.md) explains the third row. Managed
composition binds these surfaces to one app, avoiding an ambient “current app.”
`getServerRouteServices` and `createLazyServerRouteServices` are public
setup/compatibility helpers, **not authorization helpers**. Their getters resolve
services lazily; obtaining a service does not grant permission to call it.

## Request Members

`access` is the request's Guardian authorization facade. `scope` is the
validated application/tenant data boundary, or null when a multi-tenant request
has not selected an authorized organization. Identity-only authentication is
not an organization data capability.

| Member | Behavior |
| --- | --- |
| `data` | bound asynchronous tenant-file client; null outside Fabric tenant-database isolation |
| `storage` | scoped drive/object/permission/upload facade; null when unavailable or no data scope |
| `notifications`, `rooms` | current-actor/scope facades; null when unavailable or no scope |
| `workflows` | scoped run operations; privileged registration/lifecycle methods are not here |
| `pdf` | scoped renderer/storage bridge when configured |
| `auth` | compiler/evaluator access; multi-tenant requests cannot use raw user/role/token stores |
| `observability` | emitters bound to request authority; multi-tenant requests cannot inspect raw global sinks/stores |
| `unsafe` | deliberately privileged setup bag; trusted app code assumes enforcement responsibility |

Availability depends on configuration and readiness. Check nullable services.
Do not treat a TypeScript property on the broad request interface as proof that
a raw service is allowed at runtime.

## Data And Permission Are Separate

`zero.data` exposes bounded `get`, `list`, `find`, named `query`,
`mutate`, `batch` and named `command` operations. It closes over a trusted
tenant; it accepts neither a tenant ID nor a path. Each operation takes a
short-lived coordinator binding, applies the live authority fence and releases
the binding afterward.

That protects physical selection and stale authority. It does **not** invent
your app's resource permissions, ownership rules or field visibility. Use
Resource policies/generated routes for their declared enforcement, or enforce
the custom domain rule before a custom data operation.

For example, this *endpoint fragment* assumes multi-tenant Guardian,
Fabric tenant-database isolation, a declared `notes:read` permission and a
registered `notes` table:

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET',
  path: '/api/notes',
  auth: { tenant: 'required', permission: 'notes:read' },
  async handler({ zero }) {
    // This route is configured only in the tenant-file mode.
    if (!zero.data) return { available: false };
    const result = await zero.data.list('notes', { limit: 20 });
    return { available: true, ...result.value };
  },
});
```

This grants a bounded tenant table read, not user-specific row filtering.
An app that limits notes to their author needs an additional domain/resource
policy. Read results carry `value` and a per-database `sequence`; writes
require explicit idempotency keys and return commit receipts. Do not replace
accepted mutations with fire-and-forget optimistic success.

## Raw Access Is Deliberate

Multi-tenant requests block unscoped `db`, `syncDB`, `databases`,
`sql`, `sqlite`, `system`, `tokens`, `kv`, `counter`, `limiter`,
`vector`, `vectors`, `emailRuntime`, `scheduler` and
`workflowRegistry`. Access raises `UnsafeServerServiceAccessError` with
`ZERO_UNSAFE_SERVICE_REQUIRED`. A normal handler should use a scoped capability,
not catch this error and automatically retry through `unsafe`.

Single-tenant compatibility retains broader raw service access. Even there,
public/webhook routes do not become authorized merely because an application
scope exists. Explicitly authenticate their intended proof.

`zero.unsafe` does not silently add tenant or field policy. Restrict privileged
operations with live application permissions and server-derived targets.
[Data planes](./data-planes.md) distinguishes application and system handles.

## Revocation And Asynchronous Work

Projection is deferred until credential admission so API-key identities do not
leak into an optional/public context before an explicit policy accepts them.
Built-in scoped operations revalidate authority at their relevant read/commit
and asynchronous boundaries. Role/membership/property or credential changes
can reject an in-flight request with `AUTH_STATE_CHANGED` (409).

A retry must use current authority. Do not use a stale captured projection for a
later detached job; create a durable execution binding or the strict machine
projection instead. Legacy token adapters that support only async resolution
cannot prove a synchronous commit fence and fail closed for that mutation path.

## Verification

Use synthetic fixtures to test anonymous/selection sessions, an authorized
tenant, revocation while a call is pending, raw-service rejection and two
organizations with different records. Test the domain permission separately
from file isolation. Do not infer authorization from a successful SQL lookup.

## Related Guides And Next Steps

- [Machine services](./machine-services.md) projects an already verified non-browser principal.
- [Plugins](./plugins.md) supplies narrow dependencies during trusted setup.
- [Data planes](./data-planes.md) identifies the handles that must remain privileged.
- [Guardian](../guardian/index.md) owns live identity and permission semantics.
