---
id: zero.guardian.sessions
type: architecture
audience: [developer, agent]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: page-access-and-refresh-sessions
maturity: supported
applies_to: ["2.6.0"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Page, Access And Refresh Sessions

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian stores durable session authority in the system database and signs
different credentials for API access and safe page navigation. The live
session is authoritative; a JWT's embedded role or tenant snapshot is not a
permanent permission grant.

## Credential Responsibilities

| Credential | Accepted use | Lifetime and authority |
| --- | --- | --- |
| Access JWT | API bearer authentication | Short lifetime; current user/auth generation and bound session are rechecked. |
| Refresh token | Session rotation | One-time use; stored by hash, bound to a durable parent session. |
| Page JWT cookie | Safe page navigation | HttpOnly view of the refresh/session family; never API bearer authentication. |
| MFA transition/setup token | MFA ceremony | Limited purpose, not a completed API session. |
| Tenant-selection credential | Multi-mode selection | Chooses a server-owned membership, not unrestricted app access. |

Access TTL defaults to `15m`, refresh TTL to `7d`. At managed app level,
`auth.accessTokenTTL` and `auth.refreshTokenTTL` override
`ACCESS_TOKEN_TTL` and `REFRESH_TOKEN_TTL`, which override those defaults.
These are startup inputs; changing the configuration is not a retroactive
extension of an already-issued session's expiry.

## Resolve Live Authority, Not Just A Signature

`TokenService.verifyAccessToken()` verifies the signed token.
`TokenService.resolveAuthContext()` additionally resolves current Guardian
authority: active account, auth generation, current runtime profile, session
status/generation, membership, tenant and MFA assurance.

Applications should normally receive this resolved context through
[managed endpoint admission](../runtime/endpoints.md), not manually decode a
JWT and trust its `role` field. A valid JWT can cease to authorize work before
its expiry because the account, session, membership or policy changed.

Browser sessions have a durable parent and refresh children. Tenant switches
replace the parent so old access/page/refresh credentials cannot retain the
previous scope. Native sessions use their own client-bound durable authority,
described in [native clients](./native-provider.md).

## Page Cookie Behavior

The page-cookie name is application-owned: `__zero_page_session_` followed by
32 hexadecimal characters derived from Guardian's persisted application ID.
It is stable across a restart of the same SYSTEM database, not derived from a
display name, browser-supplied host or client ID. Cookies do not distinguish
ports, so application ownership prevents two Zero apps on the same hostname
from replacing or clearing each other's page credentials. This is separate
from the browser SDK's own credential-storage namespace.

The cookie has `Path=/`, `HttpOnly`, `SameSite=Lax`, expiry/max-age bounded by
its backing refresh/session authority, and `Secure` for secure requests.
Guardian does not expose it to JavaScript. Apps should let Guardian issue and
clear the cookie rather than hard-code a deletion header or a cookie name.

File-router page-cookie admission is limited to GET and HEAD. An explicit
`Authorization` header takes precedence; invalid explicit credentials never
silently fall back to a valid ambient cookie. A present application cookie is
authoritative even if empty or malformed; it never falls back to another
credential. An invalid application cookie on a safe page request is cleared.
Unsafe methods and API routes do not gain cookie-based authentication through
this page mechanism. Native consent POST separately uses the same validated
cookie resolver under its existing native origin/consent protections; it is
not general cookie-authenticated API access. See
[native clients](./native-provider.md).

Older releases used the host-wide name `__zero_page_session`. When the new
application cookie is absent, Guardian accepts that legacy cookie only after
its own TokenService validates the live local session. A successful session
completion migrates the credential to the application-owned name. Refresh and
logout capture verified legacy ownership before retiring the old proof, so
they can clear the proven local legacy cookie afterward. An invalid or
foreign legacy cookie is not erased merely because it was presented to a
different app. This compatibility path does not admit arbitrary JWTs or skip
live session checks.

At a reverse proxy, preserve the request's HTTPS scheme correctly and configure
trusted ingress. Cookie security does not make untrusted forwarded headers
into an authentication authority.

## Rotate And Log Out

`POST /auth/refresh` accepts `{ refreshToken }` and returns a new access/refresh
pair, plus the active tenant in multi mode. Rotation consumes the old child
once. Replay of a revoked refresh token invalidates the user's refresh/session
families and bumps its security generation, rather than just rejecting that
single token. Concurrent rotation is not a supported way to obtain two independent
replacement children.

`POST /auth/logout` accepts an optional `refreshToken`, revokes that credential's
family when supplied, revokes a valid page-session family from the request,
clears the page cookie, and returns `{ ok: true }`.

Use the client refresh/logout operations instead of clearing localStorage alone.
Dropping browser state without server revocation leaves server-owned credentials
alive. Conversely, a logout success should retire protected client caches and
subscriptions, not merely redirect while retaining rows.

Invalid refresh returns `INVALID_REFRESH_TOKEN` (401), with page-session clearing.
Multi refresh with no longer available active membership fails closed.

## Restore Without Showing A Previous Scope

Frontend auth restoration and data readiness are distinct. Wait for the auth
client's restoring state and authorization scope transition before showing
protected collections, pending mutations or tenant-sensitive panels.
A completed unauthenticated state must show public login/bootstrap pages;
a revision increment after anonymous sync reset is not an ongoing restoration.

Normal refresh, startup restore and browser session replacement use bounded
credential-lock and response-body operations. Transient network/server errors
retain recoverable proof while protected data remains hidden; definite
credential rejection retires the session. A rebuild alone should not invalidate
a session whose SYSTEM authority and signing material remain intact. If the
authority really changed, recovery must settle to a usable signed-out state,
not require manual cookie deletion. See
[bounded browser recovery](../../frontend/runtime/scope-transitions.md#bounded-recovery)
for the SSR/browser reconciliation flow and its explicit Retry/Sign out paths.

A tenant/user/authority change retires rows, selection, queued edits and stale
request completions. Do not copy protected data into an unscoped application
store that survives those changes. See [reactivity](../../concepts/reactivity.md).

## Signing Keys And Public Keys

`AUTH_SIGNING_KEY`, when configured, is a private JWK represented as JSON or
base64 JWK; PEM is not the accepted input. Otherwise managed Guardian persists
a generated ES256 key pair in system SQL. This is token signing material, not
a service API key or HMAC secret.

`GET /auth/jwks` exposes the public JWK Set. External signature verification
alone does not reproduce Zero's current-session, generation, tenant or
permission checks. Never embed the private key in a frontend/native SDK.

## Background Work And Revocation

For trusted background execution, capture a non-credential authority reference
through the supported server service boundary and re-resolve it at admission
and commit. Do not persist raw bearer or refresh tokens in workflow memory.
An authority reference is not a permission bypass: it must fail when its
account/session/membership authority is no longer current.

The service-lifecycle and exact callback fencing rules are in
[service boundaries](../../concepts/service-boundaries.md). Local user mirrors
are not authentication records.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Login](./login.md) covers password and account gates.
- [Tenancy](./tenancy.md) covers selection and scope replacement.
- [Identity projection](./identity-projection.md) separates canonical users from FK anchors.
- [API keys](./api-keys.md) provides non-session app credentials with explicit admission.
- [Upgrade guide](../../guides/upgrade.md) separates source availability from an installed release.
