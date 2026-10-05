---
id: zero.runtime.machine-services
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: verified-machine-principals
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

# Project Verified Machine Authority

[Runtime index](./index.md) · [Documentation index](../../index.md)

`createAuthorityScopedServerServices` is the public server-only integration
boundary for app-owned credentials and background principals. It gives an
already verified actor tenant-bound service capabilities **without fabricating
a browser session**.

It does not verify your HMAC, opaque token, mTLS identity or other app credential.
Your trusted credential adapter must establish and revalidate the principal,
current Guardian membership, credential ceiling and server-owned organization
binding before projection.

## Public Imports And Options

```ts
import {
  createAuthorityScopedServerServices,
  type CreateAuthorityScopedServerServicesOptions,
  type AuthorityScopedServerServices,
} from '@zero/framework/server';

// Integration fragment: only call this with server-verified options.
export function projectVerifiedMachine(
  verified: CreateAuthorityScopedServerServicesOptions,
): AuthorityScopedServerServices {
  return createAuthorityScopedServerServices(verified);
}
```

This is not a standalone authenticator. “verified” is a trust precondition, not
a type-level guarantee that a caller validated arbitrary JSON.

| Option | Requirement |
| --- | --- |
| `access` | live Guardian authorization facade for the verified actor |
| `services` | concrete app-local privileged setup services |
| `scope` | server-derived committed `ServiceDataScope`, not a body/query tenant selector |
| `assertCurrentAuthority` | mandatory async fence for operations that yield |
| `assertCurrentAuthoritySync` | mandatory synchronous live fence for read/commit boundaries |
| `request` | optional request metadata; omit for background work |
| `userProperties` | optional captured policy properties; shallow-copied/frozen for the projection |

The factory validates that both fences are functions and invokes the
synchronous fence before exposing a capability. A promise-returning function
is not a valid synchronous fence. A no-op fence does not meet this boundary's
security requirements even if it satisfies a TypeScript signature.

## What The Projection Contains

The strict result exposes only:

- `access` and `scope`.
- `data`: bound tenant-file operations when configured, otherwise null.
- `auth.authorization`, `auth.authorizationKernel` and
  `auth.getAuthorizationKernel`: compiler/evaluator access, not mutation stores.
- Scoped `storage`, `notifications`, `rooms`, `workflows` and `pdf`,
  nullable when those services are unavailable.
- `observability.emitCode`, `emitEvent`, `error`, `info` and `warn`.

There is no `unsafe`, raw SQL/database manager, user store, token service,
resource registry, global KV, AI, email or vector service. Property access and
reflection are restricted; an omitted raw property cannot be recovered by
enumerating the proxy. Rejected access uses `ZERO_UNSAFE_SERVICE_REQUIRED`.

If an operation needs a capability not in this facade, design a narrow trusted
adapter with its own authority/secret handling. Do not cast the facade to the
privileged bag. Durable workflow/agent integration has its own execution
service provider; it is not permission to expose all setup services to a run.

## Live Fences

The credential's initial verification is only admission. Each fence must compare
the captured authority with **current** server state: credential validity and
ceiling, account/membership status, organization binding, roles/permissions and
any policy properties that govern the operation.

A revoked credential or moved/suspended membership must reject before a later
read or commit. Async work must also reject stale results at the facade's
completion boundary where enforced. An app-owned adapter must not reuse a
memoized “passed once” result as commit-time revalidation.

The projection supplies scope closure, not all application policy. A custom
database command still needs its declared domain permission; a local user
anchor still does not prove ownership. The [request-service guide](./server-services.md)
explains that separation.

## Operational Use

Capture only secret-free durable identity references for background work.
Never put a raw API key or HMAC secret in workflow memory, queue metadata or
diagnostic events. Reconstruct live authority when execution resumes, rather
than persisting a privileged service object or JavaScript closure.

Scope-attributed emitters add authority metadata. They do not redact arbitrary
application payloads. Record safe identifiers and outcomes, not credentials or
message contents.

## Verification

Hold a synthetic external credential verification/operation on a barrier,
revoke its membership or key, release the barrier and check that read/write
completion cannot retain old authority. Also test initial stale rejection,
the absence of raw capabilities and cross-organization file/storage isolation.

The options contract is intentionally strict. There is no supported fallback
that accepts an untrusted tenant selector or converts a machine credential
into an invented human session.

## Related Guides And Next Steps

- [Service boundaries](../../concepts/service-boundaries.md) compares all three authority surfaces.
- [Request services](./server-services.md) describes normal HTTP projection.
- [Guardian](../guardian/index.md) owns live permissions, membership and credential ceilings.
- [Observability](./observability.md) explains safe app-local event attribution.
