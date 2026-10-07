---
id: zero.frontend.runtime.scope-transitions
type: architecture
audience: [developer, agent]
owner: frontend-runtime
status: verified
visibility: internal
system: frontend-runtime
feature: scope-transitions
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, Guardian single, Guardian multi, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "554caea1e5570ab4f52d3f4f82b2d75e004fbf7e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
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

## Permission Rechecks Are Not Session Failures

Live authorization hints can refresh on a timer, focus, visibility or network
reconnection. After a server-declared read-authority purge, Zero masks protected
data until replacement authority is ready. That temporary loading state does
not, by itself, request credential recovery, rotate a refresh token or reload
the document. An unchanged authority projection resumes the existing page.

A failed recheck after a purge keeps unsafe data hidden and offers a bounded
access-recheck retry. It does not label a network or policy-hint failure as
proof that the session expired. Definite credential rejection still retires
the session through the normal SDK lifecycle.

When live authority genuinely changes, old SSR loader data must not be reused.
For matching account, role and organization identity with a changed authority
revision, Zero reloads the stale document without unnecessarily rotating
credentials. Identity/page-cookie disagreement uses the separate recovery flow
below. Neither path skips the strict revision comparison.

## Bounded Recovery

A generated SSR payload missing a trustworthy authorization boundary is not
assumed to match. When browser credentials can be recovered, a mismatch performs
credential restoration, current-user hydration and live authorization before a
fresh document reload. The refresh route synchronizes the HttpOnly page cookie.
If the server alone is signed in and no browser proof remains, the normal logout
route clears that page session before reload. User-null after interrupted
restoration is not equivalent to having no recoverable credential.

A same-document recovery marker prevents an endless reload loop for an unchanged
mismatch. The marker survives pending restoration and provisional authority;
clear it only on settled authoritative agreement. Persistent disagreement
displays Retry session and explicit Sign out instead of continuously reloading
or exposing stale loader data. Retry performs the actual recovery operation;
network/temporary server failures keep credentials available for retry, while
definite rejection settles a clean signed-out state. Never edit injected
globals or weaken identity/role/tenant/revision comparison to assert a match.

The first automatic repair displays a neutral accessible transition status,
not the `Session refresh required` error panel. That explicit panel is reserved
for failed or persistent recovery. A healthy hard refresh or unchanged permission
recheck should not present an error and then immediately sign the user back in.

Credential-lock admission and each recovery network/body read have a bounded
15-second deadline. Ordinary refresh and externally replaced browser sessions
use the same bounded transport: a stalled refresh must not hold the credential
lock indefinitely and prevent Retry or Sign out from progressing. Replacement
retires the old in-memory user and tenant before attempting the new proof. A
temporary replacement failure clears loading, retains the new recoverable proof
and exposes recovery; it does not restore the old identity or silently delete
the new session. An initial restore and one automatic repair may each use
their own deadline; the UI does not promise a 15-second whole-page timeout.
Sign out retires local authority even if the remote server is unreachable, but
does not claim that an unreachable server acknowledged HttpOnly-cookie cleanup.

Guardian's page cookie is application-owned and stable across a restart of the
same SYSTEM database. The validated compatibility path for older host-wide
cookies is described in [Guardian sessions](../../backend/guardian/sessions.md#page-cookie-behavior).
Cookie namespace isolation is not a diagnosis of every deployed recovery
incident: inspect whether proof was rejected, a request failed temporarily, or
an SSR payload remains stale before attributing the cause.

The current page proof binds to the durable session rather than the rotating
refresh child. A late rejected read-only document cannot delete a newer cookie
by name. Startup rotation and `/auth/me` hydration also share one browser lock,
preventing a legal same-family rotation in another tab from interrupting that
identity lookup. These are framework-owned corrections; consumers should not
disable scope fences or clear cookies manually to obtain normal navigation.

This page-session repair is separate from `reconcileAuthSession()`, which
retries the local data barrier after credentials already committed. Do not
replay login, invitation or other one-time proof issuance to repair a cookie
or a local barrier.

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
The current session correction also has synthetic HTTP/cookie and real-browser
evidence in the
[profile-upgrade qualification ledger](../../_work/audits/guardian-profile-qualification.md).

## Related Guides And Next Steps

- [Authorization scope boundary](./authorization-scope-boundary.md) shows custom fences.
- [AppProvider](./app-provider.md) installs the complete presentation guard.
- [Hydration](./hydration.md) owns route modules and server payload consumption.
- [Runtime data planes](../../backend/runtime/data-planes.md) explains physical placement.
