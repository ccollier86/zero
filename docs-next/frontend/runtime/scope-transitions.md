---
id: zero.frontend.runtime.scope-transitions
type: architecture
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: scope-transitions
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Replace Scope Without Reusing Old Data

[Runtime index](./index.md) · [Documentation index](../../index.md)

Switching accounts or organizations is more than replacing an access token.
Cached rows, form drafts, modal state and SSR loader data can belong to the old
authority. Zero's browser runtime treats the replacement as a presentation and
request boundary while Guardian remains the server enforcement layer.

## Sequence

1. A session/scope transition begins; its boundary becomes unstable/not ready.
2. Old protected UI is synchronously masked. Scoped overlays and relevant client
   data are invalidated rather than waiting for a new page to finish loading.
3. The replacement credential/authority is committed and its data is validated.
4. Without an SSR route payload, the new ready scope can render its partition.
5. With generated route data, the browser compares its live boundary to the
   server-authored payload. A mismatch keeps old data hidden and reloads the
   current route so server loaders/page-session checks run for the new scope.

The [boundary hook](./authorization-scope-boundary.md) exposes opaque keys and
readiness for custom state. Internal display helpers are not application-owned
permission functions or a reason to import framework private files.

## Restoring Versus Signed Out

A genuinely pending restoration/transition can show an accessible status such
as signing in, switching secure access or restoring a session. Once the browser
is fully signed out, public login/bootstrap pages must be reachable even after
an anonymous data reset increments the local data revision. Ready does not mean
authenticated; stale authenticated data is still blocked separately.

If a page is stuck, distinguish actual restoration, unresolved authority, data
validation and an SSR/browser boundary mismatch. Do not suppress the guard or
carry old rows into an apparently fresh session as a workaround.

## Bounded Recovery

A generated SSR payload missing a trustworthy authorization boundary is not
assumed to match. An initial page-cookie/browser-session mismatch reloads once
under its recorded boundary. If only the server page session is signed in, the
normal logout route can clear that HttpOnly page session before reload.

A same-document recovery marker prevents an endless reload loop for an unchanged
mismatch. Persistent disagreement displays recovery instead of continuously
reloading or exposing stale loader data. Use normal login/logout/configuration
paths to resolve it; never edit injected globals to assert a match.

## Async Work And Ownership

Custom callbacks must capture and recheck the boundary after awaits. Normal SDK
requests and components have their own scope/result guards, but a caller's
independent state must not infer those guards from having used a client once.
Discard or mask old selections, edits and loaded query results at replacement.

A rejected browser wait does not prove a server write was cancelled. Exact
mutation receipts, service idempotency and committed data remain owned by their
respective SDK/server contracts. UI state protection cannot roll back an already
accepted operation or grant access to another realm.

## Verification

In a synthetic application, hold a query and edit pending, switch tenant, and
release both. Old data and success callbacks must not appear in the new tenant.
Also exercise an expired/stale page cookie with a fully anonymous browser and a
same-scope authority revocation. The correct remedy is the session/data contract,
not weakening display isolation.

Source-boundary tests and focused component regressions support this draft;
installed artifact and full production hydration mode qualification remain
separate. [Guardian sessions](../../backend/guardian/sessions.md) specifies the
canonical revocation/refresh semantics.

## Related Guides And Next Steps

- [Authorization scope boundary](./authorization-scope-boundary.md) shows custom fences.
- [AppProvider](./app-provider.md) installs the complete presentation guard.
- [Hydration](./hydration.md) owns route modules and server payload consumption.
- [Runtime data planes](../../backend/runtime/data-planes.md) explains physical placement.
