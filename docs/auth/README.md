# Guardian Authentication and Authorization

For current feature/configuration guidance, start with the source-audited
[Guardian index](../../docs-next/backend/guardian/index.md). Adaptive
[own profiles](../../docs-next/backend/guardian/user-profiles.md),
[contact verification](../../docs-next/backend/guardian/contacts.md),
[private avatars](../../docs-next/backend/guardian/avatars.md),
[presence](../../docs-next/backend/guardian/presence.md) and
[profile UI](../../docs-next/frontend/guardian/profile-settings.md) have focused
guides there. Their version/evidence markers distinguish source work from a
published upgrade; this long reference remains a compatibility entrance.

**Register. Login. Keep identity private by default.**

**Guardian** is Zero's app-local identity, session, tenancy, and authorization
system. The product name is documentation vocabulary only: existing `auth.*`
configuration, `/auth/*` routes, package exports, and TypeScript symbols remain
stable.

Guardian is self-hosted inside each Bun runtime and backed by the app's pinned
system ReactiveDB (`systemDb`), always separate from the application `db` in
managed apps. File-mode runtimes sharing that system SQLite file also share
durable session authority and promptly revalidate their own sockets; this is
not cross-host replication. User and session data travel through authenticated
auth APIs; default `createApp()` policy exposes only authorized system
projections, not the Guardian `users` authority table, through generic Sync.
See [System and Application Database Planes](../framework/system-database.md)
for the ownership, ID-anchor, and upgrade boundary. Argon2id passwords,
ES256 JWTs, generation-aware Bearer verification, and a revocable HttpOnly page
session support browser, SSR, and installed-app sessions without an external
auth service.

Zero's additive multi-tenant and advanced-authorization direction is defined in
[Zero Auth Philosophy](./zero-auth-philosophy.md), with delivery status tracked
in the [implementation checklist](./multi-tenant-auth-implementation-checklist.md).
The configuration, tenant persistence, bootstrap, tenant-bound sessions,
selection/switching, registered-resource isolation, shared policy adapters,
durable advanced role-assignment runtime, active-tenant member APIs, tenant
switcher, member management, exact-email invitations, retained join requests,
and onboarding UI described below exist in this tree. The smallest
request-only verified-domain flow is also implemented across strict server
evidence, routes, persistence, DNS/mailbox verification, browser SDK/hooks, and
fail-closed packaged UI. See
[Verified Company-Domain Onboarding](./verified-domain-onboarding.md) for the
configuration, contract, security lifecycle, and deliberate exclusions.
Omitted mode configuration continues to mean
`single/simple`. See [Tenant Member Administration](./tenant-member-administration.md)
and [Tenant Invitations and Join Requests](./tenant-invitations-and-join-requests.md)
for their request boundaries, SDKs, hooks, security lifecycle, and packaged UI.
The separate `single/advanced` control plane is documented in
[Application Access Administration](./application-access-administration.md).
Multi-mode bootstrap, the protected Administration Organization, its people,
and the capability-gated customer-organization directory are documented in
[Platform Administration Organization](./platform-administration.md).
The sanitized live browser projection, hooks, and fail-closed visibility gates
are documented in
[Browser Authorization Snapshot and Gates](./browser-authorization.md).
Security and authorization control-plane changes now use the app-local,
append-only trail documented in
[Durable Authorization and Control-Plane Audit](./control-plane-audit.md). It
is intentionally separate from general page/data activity logging.
[Guardian User API Keys](./api-keys.md) documents the opt-in, user-bound
credential capability, explicit per-route admission, session-only lifecycle
APIs, browser SDK/hook, and standalone packaged controls. API-key authority is
hydrated from the same live user, tenant, and RBAC state as browser sessions;
enabling the capability does not widen existing routes.
Runtime startup, invariant, native-protocol, email-delivery, and browser
control-plane failures follow the privacy-safe contract in
[Auth Operational Failure Contract](../observability.md#auth-operational-failure-contract).

Guardian's four profiles and the boundaries documented here are supported in
Zero 2.0; that does not imply every planned enterprise control has landed. The
protected Administration Organization and bounded
customer-organization lifecycle UI are implemented. Upstream enterprise SSO, break-glass,
tenant-custom roles, broader populated-app discovery/migration tooling, and
verified-domain autojoin/aliases/direct transfer remain deferred. The narrow,
exact pre-024 Administration Organization reconciliation path is documented in
[Platform Administration Organization](./platform-administration.md#adopting-the-administration-organization-on-a-pre-024-installation).
Registered
resources now declare explicit server-owned client exposure and field-level
allow-lists. Managed file-mode runtimes sharing the relevant SQLite plane relay
that plane's tracked changes or auth/session invalidations across active
sockets. Multi-mode startup
validates actual non-partial tenant-leading indexes, tenant-scoped business
uniqueness, and composite tenant consistency for foreign keys between
registered tenant resources.
The implementation checklist records shipped evidence, public-package gates,
and deliberately deferred capabilities.

The capability vocabulary is available now so configuration can be explicit:

```ts
auth: {
  tenancy: 'single',
  authorization: 'simple',
}
```

Omitting either field produces the same resolved values. All four combinations
normalize deterministically, and the server-only authorization config can
declare a validated permission registry and static role templates. Its
positive `registryVersion` (default `1`) is durably fingerprinted by migration
`027`; same-profile semantic changes require a monotonic bump, while
label/description-only changes do not. Same-version drift, rollback, corrupt
markers, and implicit reactivation of retained assignments under a reused role
key fail startup. A supported profile-axis transition may retain the version
only when permission, role, and evaluator semantics are otherwise identical;
a combined profile-and-registry rollout still requires a bump. In `multi`
mode the auth runtime creates tenant and membership stores, and registration
atomically creates the protected Administration Organization plus its owner
membership during bootstrap. Later customer organizations are explicitly
created and later identity registration is independent of tenant admission. The
pure `AuthorizationKernel` compiles and evaluates the shared policy vocabulary,
and the HTTP, route, Sync, resource, token, and page-session adapters hydrate
its live authority. Doctor accepts `multi` and validates tenant resource
boundaries and accepts both advanced profiles. In `single/advanced`, startup
blocks an ownerless existing installation until an exact configured adoption
target is supplied.

Installed applications use the system-browser OIDC/PKCE flow documented in
[Desktop, Mobile, and Chrome Extension Authentication](./native-app-auth.md).
Choose the correct surface with the
[App Authentication SDK Guide](./app-auth-sdk-guide.md). The TypeScript
`@zero/framework/native` core is implemented in this tree. Rust/Tauri is an
independent functional private `0.0.0` preview with working OIDC/PKCE, rotating
sessions, tenant list/switch, bounded authenticated HTTP, and a deny-by-default
Tauri v2 surface. It is not released and still has release, security, license,
ownership, host-platform adapter, and real-platform certification gates. The
independent `@zero/chrome-auth` MV3 repository is likewise a functional private
`0.0.0` preview, not a released package, and still has framework-peer,
real-Chrome lifecycle, release, and independent security-review gates.
Standalone SDK repositories are deliberately excluded from the framework
package and from applications created or updated by the Zero CLI.

## The Full Loop

```ts
// ─── Advanced standalone composition (shared manually) ──

import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  createAuthMiddleware,
  getTokenService,
  installAuthStopBarrier,
} from '@zero/framework/auth';
import {
  createDefaultSyncPolicy,
  createSyncPlugin,
  type ReactiveDB,
} from '@zero/framework/sync';

let db!: ReactiveDB;
const sync = createSyncPlugin({
  db: { mode: 'memory' },
  onDatabaseCreated(created) {
    db = created;
  },
  tables: {
    todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
  },
  auth: {
    required: true,
    getTokenVerifier: getTokenService,
  },
  policy: createDefaultSyncPolicy({
    readProtectedTables: ['users'],
    writeProtectedTables: ['users'],
  }),
});

const app = installAuthStopBarrier(new Elysia()
  // Low-level standalone composition deliberately supplies one DB to both.
  .use(sync)
  .use(createAuthPlugin({
    db,
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
    },
    registration: {
      mode: 'public',
    },
  }))
  .use(createAuthMiddleware(getTokenService))
);

app.listen(3000);

// During shutdown, the barrier joins auth email work before Sync disposes its DB:
// await app.stop();

// POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/change-password
// GET  /auth/me, /auth/authorization, /auth/jwks
// WS   /sync (Bearer-required; app-table access follows the supplied policy)
// The users table is not readable or writable through generic Sync.
```

Install `installAuthStopBarrier()` after composing a standalone Elysia app.
Elysia invokes asynchronous plugin stop hooks without joining them, so the
barrier drains auth-owned asynchronous work before normal plugin stop hooks
dispose that standalone database. `createApp()` already installs the platform-wide
equivalent.
Doctor's usage audit warns when it sees a directly composed public
`createAuthPlugin()` without an invoked barrier; ordinary `createApp()`
composition does not trigger that warning.

```ts
// ─── Client: register and use ─────────────────────────

// First installation only: the packaged RegisterForm asks for this operator
// setup key. Ordinary registrations omit bootstrapSecret.
const { accessToken, refreshToken, user } = await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'alice',
    email: 'alice@example.com',
    password: 's3cret!',
    bootstrapSecret: operatorSetupKey,
  }),
}).then(r => r.json());

// First-install result: { ..., role: 'admin' }. Later public registrations are users.

// Use token for authenticated requests
const me = await fetch('/auth/me', {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json());

// Refresh when access token expires
const { accessToken: newAccess, refreshToken: newRefresh } = await fetch('/auth/refresh', {
  method: 'POST',
  body: JSON.stringify({ refreshToken }),
}).then(r => r.json());
```

That snippet illustrates the raw HTTP protocol for a custom client. In a Zero
browser app, use the `Client` supplied by `AppProvider`: its auth methods,
`client.api`, and `client.fetch()` own stored-session restoration, refresh,
multipart credentials, and account/tenant scope fencing. Do not build an
ordinary browser transport by reading and attaching `client.token` manually.

```tsx
// ─── React: current authenticated user ────────────────

function UserProfile() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <span>Loading…</span>;
  if (!user) return null;

  return (
    <div>
      <h2>{user.firstName} {user.lastName}</h2>
      <span>{user.role}</span>
      <span>{user.email}</span>
    </div>
  );
}
```

Registration updates the caller's auth session. Other clients do not receive a
generic `users` table stream. Current-user state comes from login, registration,
refresh, and `/auth/me`; admin user management uses the protected admin auth
API. The server re-reads live user state while verifying protected work, so role,
status, security-generation, and revocation changes do not rely on a client-side
user-table subscription for enforcement.

## Core Properties

| Property | What it means |
|----------|--------------|
| **Argon2id passwords** | `Bun.password.hash()` — native, zero dependencies, memory-hard |
| **ES256 JWTs** | ECDSA P-256 via `jose` — compact, fast verification, JWKS-compatible |
| **Generation-aware verification** | ES256 signatures verify token integrity; live user state and a per-user auth generation make security transitions immediately durable |
| **Live user verification** | Protected work re-checks the current user and security generation; properties are joined into auth payloads |
| **Revocable refresh** | Refresh tokens are opaque UUIDs, SHA-256 hashed in DB, rotated on use |
| **Persistent sessions** | Browser clients restore from the stored refresh token while direct page requests use a refresh-bound HttpOnly page session |
| **User-bound API keys** | Optional finite credentials reuse live Guardian scope/RBAC, remain denied on existing routes, and require an explicit `credentials: ['api-key']` declaration |
| **API boundary** | Page cookies authenticate only safe SSR page requests; APIs, mutations, and sync remain Bearer-authorized |
| **Private identity defaults** | Credentials stay in internal tables and default `createApp()` policy withholds user rows from generic Sync |

## Web And Installed-App Identity

Web, desktop, mobile, and extension sessions resolve to the same live Zero
user. Native OIDC does not create a parallel account table or permissions
model. After bearer verification, the middleware re-reads the user and security
generation; native access additionally requires the registered client and
exact refresh-token family to remain active.

The normal `AuthContext` remains the authorization input:

```ts
interface AuthContext {
  userId: string;
  email: string;
  role: string;
  authGeneration?: number;
  clientId?: string;
  sessionKind?: 'web' | 'native';
  scope?: readonly string[];
  sessionId?: string;
}
```

Managed Guardian contexts always populate `authGeneration`; it remains
optional in the public shape for source compatibility with standalone or
manually constructed contexts.

Use role, trusted user properties, ownership, middleware, endpoint auth, and
resource/Sync policy exactly as web routes do. `clientId` and `sessionKind` are
attribution fields for the uncommon route that needs to distinguish a shipped
client. `scope` contains OIDC identity claims (`openid`, `profile`, `email`),
not API permissions.

The installed app opens the normal Zero pages in the system browser, so
registration mode, first-user bootstrap, email verification, password
recovery, MFA, suspension, and administrator revocation remain authoritative.
Zero's packaged auth forms preserve a validated native continuation through
those flows. A password reset is deliberately sessionless: after changing the
password, the user signs in again before returning to native consent.

For setup, endpoints, redirects, SDK/broker APIs, secure-storage requirements,
Sync lifecycle, and release gates, read the
[native provider guide](./native-app-auth.md) and
[SDK onboarding guide](./app-auth-sdk-guide.md).

## Auth Request Bounds

Zero rejects oversized auth route fields with HTTP `422` and the stable
`AUTH_VALIDATION_FAILED` response before password hashing, token hashing/JWT
verification, or database lookup. The limits are deliberately much larger than
normal UI input so they protect expensive boundaries without constraining
ordinary accounts:

`src/auth/auth-request-limits.ts` is the single source of truth used by the
shared route schemas and flexible-property guards.

| Input | Maximum characters/items |
|-------|--------------------------|
| Canonical email, username, or login identifier | 254 characters |
| Current, new, setup, or administrator-set password | 1,024 characters |
| First or last name | 256 characters |
| Role | 128 characters |
| User ID route parameter | 128 characters |
| Bearer access, action, refresh, or MFA transition token | 8,192 characters |
| MFA verification code | 128 characters |
| MFA device label | 128 characters |
| Native authorization continuation | 512 characters |
| Administrator user search | 256 characters |
| User-property key | 128 characters |
| Bulk user-property write | 256 properties |
| One user-property value | 65,536 characters |
| One serialized bulk-property payload | 262,144 characters |

User-property writes retain the existing string, number, boolean, array, and
nested JSON behavior. Non-string values are serialized into the KV store and
returned through the auth user model as strings, so clients that use arrays or
objects should supply the normal `parse`/`serialize` functions to
`useUserProperty`. Only request size is bounded; applications do not need to
flatten normal profile metadata into separate keys.
These field limits complement, rather than replace, a reverse-proxy or Bun
server request-body limit for the deployment as a whole.

## Session Persistence

Access tokens are intentionally short-lived and kept only in memory. The
browser SDK stores the opaque refresh token in `localStorage` so a reload can
restore the session without making the user log in again.

In parallel, every completed auth session sets a signed HttpOnly
application-owned `__zero_page_session_<application-id-hash>` cookie. The
namespace remains stable across a restart of the same SYSTEM database; older
host-wide cookies migrate only after local session ownership is verified.
See the [current page-session contract](../../docs-next/backend/guardian/sessions.md#page-cookie-behavior).
It contains no raw refresh token and is bound to
the same revocable `_refresh_tokens` row. This lets a direct or refreshed
`GET`/`HEAD` page request pass the server route guard before browser JavaScript
runs. Ordinary auth APIs, `route.ts` handlers, mutations, server plugins and
WebSocket sync remain Bearer-only. Native consent POST separately uses the
validated page proof under its existing origin/consent checks, not general
cookie-authenticated API admission.

The SDK handles the normal lifecycle:

1. On startup, it exchanges the stored refresh token for a fresh access token,
   then loads `/auth/me`. `useAuth().isRestoring` is true only during this
   persisted-session recovery; `isLoading` also remains true.
2. Authenticated HTTP calls retry once after a 401 by refreshing the access token.
3. The sync WebSocket reads the current access token whenever it opens or reconnects.
4. Login, session-returning registration/email verification, MFA completion,
   and refresh set or rotate the page cookie.
5. Password reset/setup deliberately returns no session, clears the page cookie
   and browser auth state, and requires a fresh login with the new password.
6. Logout, rejected refresh, password/session revocation, and expiry clear or
   invalidate the page session.
7. Logout or an unrefreshable 401 clears client auth state and resets local
   synced table/state data.

In `tenancy: 'multi'`, every browser completion path (password, verified email,
and MFA) passes through the same tenant-session service. Exactly one live
membership auto-binds. More than one returns `tenantSelectionRequired` with
safe summaries and a five-minute hash-at-rest, single-use continuation; no
membership returns `tenantOnboardingRequired` with a ten-minute, hash-at-rest,
app-bound, single-use `onboarding.continuation` for invitation or join-request
admission. When live creation policy allows that identity to create a tenant,
the same proof is also exposed through the compatible tenant-creation field;
creation policy remains independently revalidated. Neither incomplete result
has an access token, refresh token, or page session.

`POST /auth/tenants/select` consumes the continuation while creating the bound
parent/refresh family. `POST /auth/tenants/create` accepts either the onboarding
continuation or current raw refresh-family proof and atomically creates the
tenant, protected owner, and new tenant-bound family. The server derives user,
actor, and owner; it never accepts those authority fields from the request.
`/auth/tenants/list` and `/auth/tenants/switch` require
the current raw refresh-family proof, not an access bearer. Switching replaces
the parent, rotates refresh authority, revokes the old `sid`, and replaces the
page cookie. The browser SDK closes an authorization-scope barrier around the
operation: it freezes writes, purges local Sync/state/ephemeral data, pending
optimistic work, and Zero-owned hook caches, rejects stale HTTP response bodies,
discards global overlays, and hides/remounts or reloads the app subtree for the
replacement scope. It reconnects and waits for the new Sync baseline before
resolving. App-owned caches should use the credential-free
`useAuthorizationScopeBoundary()` key described in the browser authorization
guide. `client.activeTenant` and
`useAuth().activeTenant` contain only the safe current summary.
The browser authorization snapshot keeps that active membership in `scope`.
When it is the protected Administration Organization, a separate additive
`applicationScope` projects live application permissions; permission helpers
check both while tenant gates stay bound to the active tenant scope. Its opaque
revision covers both scope revisions and the installed registry version.
The browser credential coordinator serializes proof-only listing with every
refresh-family rotation. This prevents a delayed list from presenting the
just-consumed proof, which the server correctly treats as replay.

Native/mobile and Chrome-extension clients using the TypeScript native SDK,
and Rust/Tauri clients using the standalone Rust preview, expose secret-free
tenant list and switch operations. Their credential-owning broker/process uses
the native refresh proof advertised by OIDC discovery; neither UI code nor an
access token or caller-selected tenant header is accepted as switching
authority. A switch atomically replaces the native refresh family, binds the
new family and access token to the selected live membership, and invalidates
the old family. A browser registration begun by native OIDC keeps its claimed
native continuation across tenant creation and resumes consent only after the
browser session is bound; the resulting native authorization captures that
validated tenant authority.

Because refresh tokens rotate once, browsers with Web Locks serialize refreshes
per Zero server across tabs and workers. A waiting tab rereads the current
persisted token after acquiring the lock instead of submitting the token another
tab just replaced. Without Web Locks, Zero uses a bounded, expiring
`localStorage` bakery lock across tabs when browser storage is available. The
in-process queue is the final same-JavaScript-realm fallback for runtimes
without either facility.

`AppProvider` also guards protected client routes when auth is enabled. If a
session cannot be restored or a refresh token is rejected, it withholds the
protected subtree and sends the browser to the configured `loginPath` with one
validated `redirect` query value. On a successful login or any authenticated
visit to the login route, that safe return path wins; otherwise Zero uses
`postLoginPath`, which defaults to `/`.

Configure these paths in `createApp()` or override them on
`<AppProvider publicPaths={...} loginPath="/login"
postLoginPath="/dashboard" />`. Packaged forms still invoke their existing
`onSuccess` callbacks, so callbacks used for analytics or other side effects
remain compatible. Under `AppProvider`, do not add a second callback solely to
duplicate the normal login navigation.

## Route Auth Modes

Zero supports two page-route auth strategies when `auth` is enabled.

Protected-first apps use the default:

```ts
createApp({
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password', '/reset-password', '/setup-password', '/verify-email'],
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

Every page route requires auth unless it matches `publicPaths`. This is best
for internal dashboards and admin tools.

Public-first apps should opt into route-owned auth:

```ts
createApp({
  auth: true,
  routeAuth: 'explicit',
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

In explicit mode, pages are public unless a page or layout exports auth config:

```tsx
import type { RouteConfig } from '@zero/framework/react';

export const config: RouteConfig = {
  auth: 'required',
};
```

Use this for apps where `/` is public, such as appointment request, intake,
marketing, or token-resume flows, while `/dashboard/*` remains protected.

Layout/page `config.auth` is server-enforced before rendering. The browser
hydration runtime also tracks the matched route auth requirement. If the user
logs out, a refresh token is rejected, or auth becomes unauthenticated while on
a protected route, `AppProvider` removes the protected subtree from the screen
and redirects with one URL-encoded local return path. Client navigation can
retain pathname, query, and fragment; a direct server response retains pathname
and query because fragments never reach the server.

The `redirect` parameter must occur exactly once and resolve to a bounded,
root-relative local URL. External, scheme-relative, malformed, duplicate,
recursive, backslash/control-character, and canonicalization-unsafe values are
ignored. `/login` and `/login/` are equivalent for recursion checks. An explicit
`postLoginPath` resolving to the login route is rejected. For compatibility,
`loginPath: '/'` with the implicit default `postLoginPath: '/'` remains a no-op
for authenticated root visits instead of redirecting in a loop.

## Protected Multipart Auth

Protected Zero endpoints do not wait until after a file body is parsed to
discover invalid credentials. `defineEndpoint()` and `defineRouter()`
automatically install an early `onRequest` guard for resolved `user` and
`admin` requirements, including inherited nested-router prefixes. The ordinary
route guard still applies to all content types, and public multipart routes are
unchanged.

Raw Elysia upload routes can install
`createProtectedMultipartRequestGuard()` before the route, with an explicit
requirement/method/path matcher, plus `zeroAuth: 'user' | 'admin'` on the route. See
[Protected Multipart Routes](./guards-and-audit.md#protected-multipart-routes)
for the complete example and failure contract.

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Password hashing | `Bun.password` (Argon2id) | Native, zero deps — built into Bun runtime |
| JWT signing/verification | `jose` | ECDSA P-256, JWKS export, one dependency |
| Database | bun:sqlite ReactiveDB | Managed apps keep Guardian in `systemDb`; advanced standalone composition may deliberately share an injected transaction domain |
| HTTP framework | Elysia plugin | Routes, derive, lifecycle hooks, composable |

## What This Is

A **standalone auth primitive** that composes with the sync engine. It owns user
identity (registration, login, password verification, JWT issuance).
`createApp()` stores that state in `systemDb` and keeps app data separate;
advanced direct plugin composition can inject a shared transaction domain when
it deliberately owns all lifecycle and policy wiring. Auth state is exposed
through purpose-built APIs rather than a generic user-table subscription.

**Designed for:**
- Applications already using the sync engine that need user identity
- Self-hosted single-application and multi-tenant products that fit SQLite's
  operational envelope
- Prototypes that need secure auth without infrastructure
- Apps that want integrated identity, declarative RBAC, tenant control, and
  policy-controlled application data

## What This Is NOT

- **Not a federated identity broker.** Zero can issue OIDC sessions to registered native apps, but it does not provide SAML, social login, or upstream identity-provider federation.
- **Verified-domain admission is deliberately request-only.** It can retain a
  fixed-role request after exact DNS and current-mailbox proof; it does not
  auto-join, create an identity, match aliases/subdomains, or transfer claims.
  Owner-authorized claim release retains history, invalidates outstanding
  admission, and enforces a seven-day cross-tenant quarantine. `multi` also includes
  tenant/membership persistence, tenant-bound sessions, selection/switching,
  creation onboarding, registered-resource isolation, active-tenant member
  administration, protected ownership transfer, exact-email invitations,
  retained join-request review/re-admission, durable invitation email, and
  packaged controls.
- **Static role definitions are intentional.** Advanced membership assignments
  are durable, live-enforced, and manageable through the active-tenant API/UI,
  while permission and role templates remain a deployment-time application
  ceiling. Tenant administrators cannot invent runtime permission semantics.
- **Not a hosted admin product.** It ships reusable global-user,
  application-access, tenant, Administration Organization, and
  customer-organization control organisms, but apps still choose where those
  controls live and how the admin dashboard is composed.

## Comparison

| | Firebase Auth | Lucia | This |
|---|--------------|-------|------|
| **Hosting** | Managed cloud | Self-hosted | Self-hosted; one runtime or shared-file replicas |
| **Database** | Proprietary | Any SQL/NoSQL | bun:sqlite (separate system authority and application ReactiveDB planes) |
| **Reactivity** | Snapshot listeners | None built-in | Policy-controlled app-table Sync; auth state through auth APIs |
| **Password hashing** | Managed | Configurable (bcrypt, scrypt, argon2) | Argon2id via Bun.password (native) |
| **Token format** | Proprietary | Session-based | Standard JWT (ES256), JWKS endpoint |
| **Dependencies** | Firebase SDK | lucia + adapter | jose (one dep) |
| **Scale** | Millions | Any | SQLite-bound; supports multi-tenant apps and coordinated shared-file replicas |
| **Result** | Same auth fundamentals for the target use case — secure identity with minimal code |

## Integration with Sync Engine

Guardian and platform tokens share the **system ReactiveDB**. Auth defines its
authority tables there, and `createApp()` mounts
`_zero_action_tokens`/`_zero_resume_tokens` on that exact system instance before
auth. That shared system transaction domain lets password and account
transitions consume one-time platform tokens atomically and emit
consumed-success telemetry only after commit; direct plugin composition must
wire the same system instance or startup fails closed. The application
ReactiveDB is separate and contains only app tables plus managed ID-only
identity anchors when app foreign keys require them. See
[Platform Tokens: Auth Transaction Boundary](../tokens.md#auth-transaction-boundary).
One WebSocket can carry authorized system projections and application data on
independent planes; that transport does not merge their storage. `createApp()`
applies row filters to scoped framework tables and composes those decisions
with the application's Sync policy. A directly composed
`createSyncPlugin()` remains public-by-default for compatibility, so standalone
apps must supply authentication and a policy explicitly, as in the example
above.

```
                    System ReactiveDB
                  ┌───────────────────────────────────────┐
  Auth Plugin ──► │  users / user_properties ── auth APIs│
                  │  credentials / sessions  ── internal │
                  │  tenants / memberships   ── internal │
                  │  RBAC / API keys / audit ── internal │
                  │  platform tokens         ── internal │
                  └───────────────────┬───────────────────┘
                                      │ ID-only projection
                                      ▼
                  Application ReactiveDB
                  ┌───────────────────────────────────────┐
  Sync Plugin ──► │  users(user_id)          ── FK anchor │
  defineTable()   │  tenant_memberships      ── FK anchor │
                  │  todos / projects        ── live Sync │
                  │  _changes                ── internal  │
                  └───────────────────────────────────────┘
                              ▲
                              └── Sync/resource policy filters app reads
```

**Policy-controlled app tables** — readable changes can flow to authorized
WebSocket subscribers through the sync engine. Table visibility, snapshot,
catch-up, live delivery, and direct mutations remain subject to the composed
Sync/resource policy.

`user_properties` is created with raw SQL because it uses a composite primary
key `(user_id, key)`. Auth joins those properties into `/auth/me`, login,
register, and admin user responses, but property mutations are not a standalone
ReactiveDB table stream.

**Internal tables** (`_` prefix) — never broadcast. Auth stores frequently use
prepared SQL directly, so those writes do not necessarily create ReactiveDB
change records. The `_` prefix is a privacy convention, not a promise that a
table participates in the Sync ring buffer.

See [Architecture](./architecture.md) for the full component diagram and data flow.

## Design Documents

| Document | What it covers |
|----------|---------------|
| [Zero Auth Philosophy](./zero-auth-philosophy.md) | Authoritative invariants and supported-versus-deferred direction for the four auth profiles |
| [Multi-tenant Auth Implementation Checklist](./multi-tenant-auth-implementation-checklist.md) | Current implementation evidence, release gates, and intentional deferrals |
| [Auth And Data-Plane Capability Matrix](./auth-data-plane-capability-matrix.md) | Enforcement owner, authoritative scope, evidence, and trusted escape hatch for each official surface |
| [Architecture](./architecture.md) | Plugin structure, Elysia integration, data flow, composition with sync engine |
| [User Store](./user-store.md) | Stable identity facade, focused credential/token/provisioning stores, SQLite schema, CRUD, and password lifecycle |
| [Token Service](./token-service.md) | JWT lifecycle, ECDSA keypair management, refresh rotation, JWKS |
| [Platform Tokens](../tokens.md) | Generic action/resume tokens plus the exact shared system-ReactiveDB auth transaction and post-commit telemetry contract |
| [Auth Guards And Audit Boundaries](./guards-and-audit.md) | Implemented request-scoped route guards and the explicit boundary between durable control-plane audit and deferred general activity tracking |
| [Control-Plane Audit](./control-plane-audit.md) | Append-only authorization/security events, atomic mutation wiring, authorized query/export, retention, SDK/hook, and packaged viewer |
| [Application Access Administration](./application-access-administration.md) | Implemented `single/advanced` assignments, protected owner, SDK/hook, and packaged UI |
| [Platform Administration Organization](./platform-administration.md) | Multi-mode bootstrap administration scope, application permissions, customer-organization lifecycle/member control plane, SDK/hooks, and packaged controls |
| [Tenant Member Administration](./tenant-member-administration.md) | Active-tenant member, role, status, ownership, SDK/hook, and packaged UI contract |
| [Tenant Invitations And Join Requests](./tenant-invitations-and-join-requests.md) | Invitation delivery/acceptance and retained join-request review contract |
| [Verified Company-Domain Onboarding](./verified-domain-onboarding.md) | Exact-domain DNS/mailbox proof, request-to-join, release/quarantine, and packaged controls |
| [Browser Authorization Snapshot And Gates](./browser-authorization.md) | Sanitized live scope, cache boundary, permission hooks, and presentation gates |
| [Guardian User API Keys](./api-keys.md) | Opt-in user-bound credentials, explicit HTTP admission, live authority, lifecycle routes, SDK/hooks, and optional packaged controls |
| [Admin User Management](./admin-user-management-plan.md) | Implemented registration policy, user/security lifecycle routes, configured properties, and production admin UI |
| [Email And Account Lifecycle](./email-account-lifecycle-plan.md) | Platform email foundation, Resend adapter, and implemented verification/reset/setup flows |
| [App Authentication SDK Guide](./app-auth-sdk-guide.md) | Choose web, TypeScript native, Rust/Tauri, Chrome, or another client and follow the installed-app onboarding checklist |
| [Desktop, Mobile, And Chrome Extension Auth](./native-app-auth.md) | Public-client registration, system-browser OIDC + PKCE, redirects, secure storage, native SDKs, and packaged platform recipes |
| [Metadata, Access Control, And Avatars Plan](./metadata-access-avatar-plan.md) | Historical access/tenancy sketch superseded by the current RBAC docs; remaining avatar ideas are still unimplemented |

### Historical and working material

[Multi-tenant, SSO, and RBAC Working Design](./multi-tenant-sso-rbac-working-design.md)
is the temporary architecture audit that led to the current implementation. It
intentionally preserves pre-implementation findings and proposed language, so
it is useful rationale but is not a current API or release contract. Use the
philosophy, focused manuals, capability matrix, and implementation checklist
above for current behavior.

## File Organization

```
src/auth/
├── auth.plugin.ts              # Composition root: lifecycle, derives, subplugins
├── auth-runtime.ts             # Auth service startup/shutdown and runtime getters
├── auth-schema.ts              # Auth table creation and compatibility upgrades
├── auth-session.plugin.ts      # Config/register/login/refresh/logout/me/jwks routes
├── auth-user-properties.plugin.ts # Current-user configurable property routes
├── auth-admin.plugin.ts        # Composition root for admin user-management routes
├── auth-admin-mfa.plugin.ts    # Admin MFA status/require/clear/reset routes
├── auth-admin-email-verification.plugin.ts # Admin verification delivery/override routes
├── auth-application-administration.plugin.ts # Single/advanced application access routes
├── auth-platform-administration.plugin.ts # Protected admin-org and customer-tenant routes
├── auth-tenant-administration.plugin.ts # Active-tenant member/role/ownership routes
├── auth-tenant-onboarding.plugin.ts # Invitations and retained join-request routes
├── auth-tenant-invitation-service.ts # Invitation issue/inspect/accept lifecycle
├── auth-tenant-join-request-service.ts # Join-request policy and lifecycle orchestration
├── auth-tenant-join-request-store.ts # Retained rows and optimistic-concurrency fences
├── auth-tenant-join-request-projection.ts # Public-safe join-request mapping
├── auth-verified-domain.plugin.ts # Verified-domain request-admission routes
├── auth-account.plugin.ts      # Forgot/reset/setup/email verification routes
├── auth-mfa.plugin.ts          # MFA setup/challenge routes
├── auth-mfa-response.ts        # Session-vs-MFA completion helper
├── auth-user-response.ts       # Public auth user response mapper
├── auth.middleware.ts          # JWT/account-generation resolution, requireAuth/requireAdmin
├── auth-config.ts              # Auth config helper and normalization
├── authorization-kernel.ts     # Pure access requirement compiler/evaluator
├── authorization-role-service.ts # Durable application/tenant role assignments
├── authorization-role-provisioning-service.ts # Bootstrap/adoption/reconciliation
├── auth-context.ts             # Authorization header to AuthContext helper
├── auth-synchronous-callback.ts # Fail-closed transaction callback guard
├── tenancy/                    # Tenant/membership schema, store, service, types
├── token-service.ts            # Stable token and live-authority facade
├── auth-signing-keys.ts        # Atomic ES256 key establishment/import
├── auth-token-codec.ts         # Strict JWT/JWKS cryptographic codec
├── auth-web-session-token-service.ts # Browser refresh/page-session lifecycle
├── user-property-service.ts    # Configured user property validation/defaults
├── auth-email-templates.ts     # Auth email template contracts/branding helper
├── mfa-challenge-service.ts    # MFA enrollment/challenge policy and OTP/TOTP verification
├── mfa-challenge-rollback.ts   # Exact pending-method/challenge compensation receipts
├── mfa-challenge-store.ts      # SQLite operations for MFA challenge rows
├── mfa-method-store.ts         # SQLite operations for enrolled MFA methods
├── mfa-secret-crypto.ts        # AES-GCM encryption for authenticator seeds
├── mfa-service.ts              # MFA config/readiness helper
├── mfa-totp.ts                 # RFC 6238 TOTP helpers
├── user-store.ts               # Stable facade: users, properties, config, collaborator orchestration
├── user-identity-store.ts      # User identity CRUD/list/count persistence
├── user-property-config-store.ts # User properties and internal auth config KV
├── user-credential-store.ts    # Password hashes and atomic security transitions
├── user-token-store.ts         # Refresh replay/revocation and legacy auth action tokens
├── registration-provisioning-store.ts # Receipt leases, finalize/recovery, exact rollback
├── types.ts                    # AuthContext, UserRecord, TokenPair, config, AuthError
└── index.ts                # Public API: all exports
```

Single responsibility per file: `auth.plugin.ts` is only the composition root,
routes stay in named Elysia controllers, runtime service lifecycle lives in
`auth-runtime.ts`, table setup lives in `auth-schema.ts`, validation/defaults
live in services, and SQL stays in focused stores. `UserStore` is the stable
identity facade; `UserCredentialStore`, `UserTokenStore`,
`UserIdentityStore`, `UserPropertyConfigStore`,
`RegistrationProvisioningStore`, `MfaMethodStore`, and `MfaChallengeStore` own
their narrower persistence/lifecycle concerns. `TokenService` likewise remains
the stable public facade while its signing-key, compact-token, and browser
session-family collaborators stay internal.

## Registration And Admin Users

### First-administrator bootstrap

An empty installation does not use an unauthenticated first-request-wins
boundary. Bootstrap is a separate, durable ceremony:

1. The default bootstrap mode is `secret`. With no configured secret, setup is
   safely unavailable and Doctor reports `auth.bootstrap.secret_missing`.
2. Configure at least 32 random characters from deployment secrets. The
   packaged `RegisterForm` renders an **Operator setup key** field only while
   `/auth/config` reports that secret-gated bootstrap is available.
3. Zero verifies that value with a timing-safe comparison inside the serialized
   database transaction that elects the provisional first administrator.
4. Successful downstream session/token provisioning finalizes a durable
   completion marker in a second transaction. A failure rolls back the exact
   provisional user/owner graph; deleting users after a completed installation
   still cannot silently reopen bootstrap later.
5. After setup, `auth.registration.mode` alone controls ordinary account
   creation, and a submitted `bootstrapSecret` is rejected.

Generate a secret with a system password manager or, for example,
`openssl rand -base64 32`. Keep it out of source, URLs, and logs. It is never
returned by the public or admin config APIs. After setup, change the config to
`bootstrap: 'disabled'` and remove or rotate the deployment value; the durable
completion marker remains authoritative. The public config also omits the exact
user count; the authenticated admin config may include it for management UI.

```ts
auth: {
  bootstrap: {
    mode: 'secret',
    secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
  },
  registration: { mode: 'admin-only' },
}
```

Bootstrap modes are explicit:

| Mode | Empty-installation behavior |
| --- | --- |
| `secret` | Default. Requires a configured secret of at least 32 characters and the matching request value. Missing configuration stays closed. |
| `public` | Legacy compatibility only. The first unauthenticated registration wins the administrator account; Doctor warns. |
| `disabled` | HTTP bootstrap is closed; a trusted provisioning path must establish the installation. |

In `single` mode, the provisioning ceremony creates the platform administrator
and, in advanced mode, its protected application-owner assignment. In `multi`
mode, `/auth/register` also requires
`organizationName` and accepts an optional `organizationSlug` (derived from the
name when omitted). The first transaction creates provisional bootstrap state:

- the user and credential, with global/platform role `admin`;
- the protected `kind: 'administration'` organization in `_auth_tenants`;
- the active `owner` membership in `_auth_tenant_memberships`;
- the advanced owner assignment when advanced authorization is enabled; and
- an exact receipt in `_auth_registration_provisioning`.

The receipt carries a bounded owner lease. The process keeps the opaque lease
token and only its SHA-256 digest and expiry are persisted. Zero renews the
exact lease before potentially slow email or session/token provisioning. After
that work succeeds, it atomically removes the receipt and writes
`auth.bootstrap.completed`. If organization, token, session, or
verification-email provisioning fails, the lease owner atomically removes the
receipt, user, tenant, memberships, role assignments, tokens, intents, and
native bindings, leaving the installation eligible for a clean retry. Startup
recovers only expired or legacy-unowned receipts and rechecks them under the
SQLite writer lock; another runtime's live registration is left untouched and
a stale runtime cannot finalize after losing its lease. The protected
last-owner exceptions are scoped to an exact pending receipt and never apply
to ordinary owner lifecycle calls. A successful multi-mode registration
returns a public-safe Administration Organization `tenant` summary alongside
its normal session, MFA continuation, or email-verification result:

```ts
interface AuthRegistrationTenant {
  tenantId: string;
  kind: 'administration' | 'organization';
  membershipId: string;
  slug: string;
  name: string;
  role: string | null; // 'owner' for the organization-creating flow
}
```

Registration does not finalize identity or an optional tenant until its
downstream provisioning has succeeded. If a finalized HTTP response is lost,
the normal at-most-once ambiguity still applies: sign in with the committed
identity instead of repeating registration. Its sole live membership
auto-binds and issues a fresh tenant session. The dedicated
`/auth/tenants/create` exchange likewise never commits a tenant while losing
its proof/session result.

Direct `UserStore.createUser()` calls cannot establish the first user while
multi-mode bootstrap is open. They fail with
`MULTI_TENANT_BOOTSTRAP_ORGANIZATION_REQUIRED`; callers must use the explicit
organization-aware registration/bootstrap domain path. Trusted direct user
creation remains available after installation and in single mode.

After bootstrap, identity registration and organization admission are separate.
`organizationName` is optional. Omitting it creates only the identity and
returns `tenantOnboardingRequired` with no access or refresh token. That
response always contains a short-lived, app-bound, single-use
`onboarding.continuation` for invitation/join-request admission; only its
SHA-256 hash is stored. When live creation policy permits, the response also
exposes the compatible `onboarding.tenantCreation.continuation`. Supplying an
organization remains an optional one-step creation path,
but it is evaluated against the resulting identity and the same configured
creation policy. Public registration never implies joining an existing
organization.

```ts
auth: {
  tenancy: {
    mode: 'multi',
    terminology: { singular: 'practice', plural: 'practices' },
    creation: {
      mode: 'authenticated', // 'platform-admin' | 'disabled'
    },
  },
}
```

The first multi-tenant bootstrap is deliberately different: it always requires
an organization and creates the protected Administration Organization plus its
protected owner in the same transaction, even when the configured
post-bootstrap creation mode is `platform-admin` or `disabled`.

```ts
createApp({
  app: {
    name: 'Acme CRM',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  },
  email: Bun.env.RESEND_API_KEY
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Acme CRM <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: { apiKey: Bun.env.RESEND_API_KEY },
      }
    : false,
  auth: {
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
    },
    registration: {
      mode: 'admin-only',
    },
    account: {
      requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      emailVerificationPath: Bun.env.AUTH_EMAIL_VERIFICATION_PATH ?? '/verify-email',
      allowAdminMarkEmailVerified: false,
    },
    mfa: {
      enabled: Bun.env.AUTH_MFA_ENABLED === 'true',
      policy: Bun.env.AUTH_MFA_POLICY ?? 'optional',
      methods: ['email', 'totp'],
      allowUserChoice: true,
      allowMultipleMethods: false,
      recoveryCodes: false, // reserved for a later recovery-code flow
      totp: {
        issuer: Bun.env.APP_NAME ?? 'Acme CRM',
        encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      },
    },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
    branding: {
      appName: Bun.env.APP_NAME ?? 'Acme CRM',
      logoUrl: Bun.env.APP_LOGO_URL,
      supportEmail: Bun.env.APP_SUPPORT_EMAIL,
      brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
    },
  },
});
```

Auth declarations are exact at runtime as well as in TypeScript. `createApp()`,
`resolveConfig()`, and `resolveAuthBehaviorConfig()` reject unknown root or
nested fields, unsupported enum values, and values with the wrong primitive
type instead of silently applying a default. `defineAuthConfig()` remains an
inference helper; validation happens when the config is resolved. Doctor
reports the same failure as `auth.config.invalid` with the resolver message.

Supported post-bootstrap modes:

| Mode | Behavior |
| --- | --- |
| `public` | Public `/auth/register` remains open and creates `user` accounts. |
| `admin-only` | Public registration is closed; admins create users through `/auth/admin/users`. |
| `disabled` | Public and platform admin creation are closed after bootstrap. |

Public UI can read:

```txt
GET /auth/config
```

Its response exposes only capability state: `registration.registrationEnabled`,
`registration.publicRegistrationEnabled`, and
`bootstrap.{required,mode,available,secretRequired}`.
It also exposes the safe resolved tenancy capability—`mode`, configured
`terminology`, and `creation.mode`—plus only `authorization.mode`; server-only
permission metadata and role templates are never returned by this public
endpoint. In `multi` mode the packaged `RegisterForm` requires the configured
tenant name only during bootstrap. Later it offers explicit optional creation
only when a newly registered identity can use the advertised policy.
The configured secret is server-only. The admin config response also omits it.
For multi-tenant or advanced profiles, the authenticated admin response carries
the resolved permission/role metadata (including protected/system and
assignable flags) needed by mode-aware controls. It does not expose assignment
history publicly. See [Platform Configuration](../platform-configuration.md)
for advanced-role declarations and the explicit existing-install owner
adoption flow. That guide also defines migration `023`'s installed-profile
marker, transactional multi/simple-to-advanced role/session adoption, the
recommended two-step legacy rollout, and every rejected reverse or tenancy-axis
transition. It also defines migration `027`'s registry-version deployment
fence, system audit events, stale-runtime behavior, and retired-role-key
reactivation guard.

Admin UI can read and manage:

```txt
GET    /auth/admin/config
GET    /auth/admin/users?limit=50&offset=0&search=ops&role=user&status=active
GET    /auth/admin/users/:userId
POST   /auth/admin/users
PATCH  /auth/admin/users/:userId
DELETE /auth/admin/users/:userId
PUT    /auth/admin/users/:userId/properties/:key
PATCH  /auth/admin/users/:userId/properties
DELETE /auth/admin/users/:userId/properties/:key
POST   /auth/admin/users/:userId/reset-password
POST   /auth/admin/users/:userId/send-setup-email
POST   /auth/admin/users/:userId/send-password-reset
POST   /auth/admin/users/:userId/clear-password-change-requirement
POST   /auth/admin/users/:userId/suspend
POST   /auth/admin/users/:userId/activate
POST   /auth/admin/users/:userId/revoke-sessions
GET    /auth/admin/users/:userId/mfa
POST   /auth/admin/users/:userId/mfa/require
POST   /auth/admin/users/:userId/mfa/clear-requirement
POST   /auth/admin/users/:userId/mfa/reset
POST   /auth/admin/users/:userId/send-verification-email
POST   /auth/admin/users/:userId/verify-email
```

The seven admin security/recovery routes return these exact top-level shapes:

| Route | Response |
| --- | --- |
| `GET .../:userId/mfa` | `{ methods, required, requirement }` |
| `POST .../:userId/mfa/require` | `{ user }` |
| `POST .../:userId/mfa/clear-requirement` | `{ user }` |
| `POST .../:userId/mfa/reset` | `{ ok: true, deletedMethods, invalidatedChallenges }` |
| `POST .../:userId/send-verification-email` | `{ ok: true }` |
| `POST .../:userId/verify-email` | `{ user }` |
| `POST .../:userId/clear-password-change-requirement` | `{ user }` |

MFA `requirement` is `user`, `global`, `admin-role`, or `none`. Requiring or
clearing a per-user MFA requirement and resetting enrolled MFA methods revoke
the user's existing sessions. The verification-email route uses the normal
one-time delivery flow. Directly marking an address verified is disabled by
default; opt in with `auth.account.allowAdminMarkEmailVerified: true`.
`/auth/admin/config` exposes the resolved setting as
`account.allowAdminMarkEmailVerified` and
`capabilities.adminMarkEmailVerified`, allowing custom and first-party UIs to
hide the override when it is unavailable.

Admin routes require an authenticated Bearer token with the authority for the
installed profile. `single` mode retains the legacy global-admin boundary. In
`multi` mode, reads require live Administration Organization authority with
`application.users:read`, writes additionally require
`application.users:manage`, and creating, promoting, demoting, or mutating a
global-admin identity still requires the server-projected global-admin
capability. Deleting or demoting the last global admin is rejected.
`GET /auth/admin/users` is paginated and supports `search`, `role`, and
`status` filters. Direct password resets remain available for manual workflows
by default, clear any password-change gate, revoke existing sessions, and can
be disabled with
`auth.accountEmails.manualPasswordReset: false`.

The preferred email-driven reset/setup routes use a delivery-only password
gate. Zero validates email readiness, serializes delivery for the target,
creates a one-time action token, and requires the provider boundary to accept
the intended recipient. Only after that succeeds does Zero set
`passwordChangeRequired` and revoke the user's sessions. A provider exception
or rejected recipient deletes the undelivered token and leaves an existing
account ungated. Admin creation with setup email is exact-state cleanup: failed
delivery removes the untouched new account so the same identity can be
retried, while any account changed or linked by another authorized operation
is preserved and only its provisional setup link and receipt are retired.
Those administrator delivery failures emit distinct verification, setup,
reset, and provisioning-compensation events with stable classifications and
cleanup status, but no address, provider message, or email content. See the
[Auth Operational Failure Contract](../observability.md#auth-operational-failure-contract).

Generic create/update payloads cannot newly set
`passwordChangeRequired: true` without setup-email delivery. If an older
deployment or operational mistake already stranded another user behind that
gate, use the confirmed
`POST .../:userId/clear-password-change-requirement` recovery action. It does
not change the password, cannot target the acting administrator, requires the
gate to exist, and invalidates sessions and outstanding action links. The
first-party admin UI exposes this as **Clear reset requirement** instead of a
raw profile checkbox.

Session revocation is durable across browser and API auth credentials. Zero
revokes persisted refresh tokens (which invalidates their bound page-session
cookies) and bumps a per-user auth generation. Access and short-lived
auth-transition tokens embed that generation and are rejected after it changes,
including after a suspended account is later reactivated.

The frontend barrel exports a ready-to-embed admin organism. It is not a page;
place it inside whatever dashboard, tab, or settings view the app owns:

```tsx
import { PlatformUserManagement } from '@zero/framework/react';

function AdminUsersPanel() {
  return <PlatformUserManagement className="h-[calc(100svh-5rem)] min-h-0" />;
}
```

`UserManagement` is now auth-profile adaptive and `PlatformUserManagement` is
its explicit platform-oriented alias. `single/simple` preserves the established
global identity manager. `single/advanced` adds application roles and
permissions to the same selected account. In multi mode it renders the active
organization's people, membership, and tenant roles; inside the protected
Administration Organization it adds compact People/Workspaces scope controls,
administrator membership/invitations, the all-identities directory, and the
customer-workspace directory. A platform operator with the dedicated
three-permission customer-member capability can manage the selected
workspace's membership, roles, and ownership there without acquiring customer
application-data access. Global password/MFA/account actions remain separately
application-authorized and never appear for tenant-only organization managers.
`TenantMemberManagement` and
`PlatformWorkspaceManagement` remain focused primitives for custom layouts,
and `TenantSwitcher` performs refresh-proof-backed scope changes. The contracts
are documented in
[Application Access Administration](./application-access-administration.md)
and [Tenant Member Administration](./tenant-member-administration.md).
The identity/account portion loads `/auth/admin/config` and
`/auth/admin/users` only when live application authority exposes those
capabilities. Its
readiness strip appears only for actionable email, verification, or MFA setup
problems. The selected-user security row likewise stays hidden for normal
verified/ready/optional states and surfaces only pending verification,
password-setup, MFA enrollment, enrolled methods, or load errors.
Capability-gated actions cover setup/reset email, manual password reset,
confirmed password-gate recovery, resend/manual verification, MFA
require/clear/reset, session revocation, suspension/reactivation, and confirmed
deletion. The UI serializes sensitive actions and applies self-action policy,
while server guards remain authoritative.

The organism also creates and updates users, promotes admins through the `role`
field, and adapts configured `auth.userProperties` into admin property controls.
Enum fields render as selects, boolean fields render as checkboxes, and
number/string fields render as typed inputs. Admin creation is unavailable when
the resolved registration mode is `disabled`.

When `strictUserProperties` is false, the same property panel also shows an
additional key/value editor for unconfigured custom properties. This lets an
admin add or edit ad-hoc Clerk-style metadata without changing app config.
When `strictUserProperties` is true, the additional editor is hidden and the
server rejects unknown property keys.

In self-wired mode it uses backend pagination plus server `search`, `role`, and
`status` filters so users beyond the first page remain reachable. For custom
dashboards, `useAdminUsers()` exposes the same SDK-backed state, page metadata,
filters, property mutations, and account lifecycle mutations without rendering
the organism. Manual password reset appears only when
`auth.accountEmails.manualPasswordReset` is enabled.

Recovery codes, per-device/session inventory and individual-session revocation,
administrator impersonation, and bulk user actions remain deferred.
`PlatformUserManagement` does not imply those capabilities. It distinguishes
identity read from identity mutation and independently gates global-admin
targets. Application and tenant RBAC, the Administration Organization, and the
customer-tenant lifecycle are implemented through the separate controls linked
above; tenant-custom roles are not part of this global identity organism.

Public account lifecycle routes:

```txt
POST /auth/forgot-password
POST /auth/resend-verification
GET  /auth/action-token/:token
POST /auth/verify-email
POST /auth/reset-password
POST /auth/setup-password
```

Email-driven routes validate delivery readiness before mutating user state.
If email is disabled they return `EMAIL_NOT_CONFIGURED`; if setup/reset/verify
links cannot be built they return `EMAIL_PUBLIC_URL_REQUIRED`.

### Email Readiness And Failure Semantics

Email readiness reflects the runtime that can actually attempt delivery, not
just an enabled config switch. `email: true` and explicit Resend config both use
`EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY` as fallbacks when the
matching config value is omitted. The built-in Resend adapter is ready only
with a non-empty sender and API key. A custom provider object owns its own
credential checks but still requires a sender. Setup, reset, and verification
links additionally require `app.publicUrl`; email OTP does not.

Custom provider adapters used for auth delivery must pass
`message.idempotencyKey` to the provider's request-idempotency boundary and
honor `message.signal` when issuing network requests. The key is stable for one
outbox attempt, while the signal lets graceful shutdown or a lost lease cancel
work Zero no longer owns. An adapter that ignores either field can still be
used for ordinary email, but cannot preserve the durable auth outbox's
cancellation and duplicate-suppression guarantees.

`GET /auth/admin/config` exposes these resolved conditions through its email
state and capability flags, so the admin UI does not advertise an action that
only looks configured. Missing readiness fails before token/account/gate
mutation. If a provider call later throws or reports that the intended
recipient was not accepted, Zero fails closed and removes the undelivered
artifact: reset/verification action tokens are deleted, registration
provisioning removes its complete optional tenant/role graph and durable
intent, admin-created setup accounts are rolled back, and email-MFA challenges
are invalidated. Those cleanup paths permit an immediate retry rather than a
silent cooldown.

Doctor reports required email verification as an error when no usable sender
and delivery provider are configured, or when neither `app.publicUrl` nor
`auth.branding.publicUrl` can build the verification link.

For durable public auth delivery, deterministic provider HTTP 4xx responses
dead-letter after one attempt with a stable, privacy-safe code. Request timeout
(`408`), Too Early (`425`), rate limit (`429`), network, abort, and provider 5xx
failures remain retryable. Provider response bodies and adapter-specific error
codes are not copied into outbox rows or observability metadata.

Set `auth.account.requireEmailVerification: true` to require post-bootstrap
public registrations to verify email before receiving access/refresh tokens.
The first bootstrap admin still receives a session immediately so an app can be
initialized before email delivery is configured. For normal public users,
`POST /auth/register` creates the account, sends an `email_verification` action
token, returns the user with `emailVerificationRequired: true`, and does not
return tokens. In multi mode it also does not issue tenant-selection or
tenant-creation continuations before verification. `POST /auth/verify-email`
consumes the one-time token, marks `emailVerifiedAt`, clears
`emailVerificationRequired`, and only then runs normal auth completion: a bound
session, tenant selection, or zero-membership onboarding as appropriate.
`POST /auth/resend-verification` always returns `{ ok: true }` for unknown,
already verified, suspended, or cooldown-limited users so it does not disclose
account existence.

When MFA is enabled, email verification is still the first gate. The auth flow
order is:

1. Registration creates the account.
2. If email verification is required, the user must verify the email token
   before receiving any app access/refresh tokens.
3. After email verification, or immediately after registration when email
   verification is not required, Zero evaluates MFA policy.
4. If MFA is required or the user requested optional MFA during signup, Zero
   returns `mfaSetupRequired` and a short-lived setup token.
5. If the user already has an active MFA method, login returns
   `mfaChallengeRequired` and a short-lived challenge token.
6. Only successful MFA setup/challenge verification returns and stores the
   normal app access/refresh token pair.

### Auth Email Templates

Zero ships branded default auth email templates. Apps can override individual
templates with plain functions while keeping the platform-owned token and
delivery flow:

```ts
// zero/auth-emails/password-reset.ts
import type { AuthEmailTemplate } from '@zero/framework/server';

export const passwordResetEmail: AuthEmailTemplate = (ctx) => ({
  subject: `Reset your ${ctx.branding.appName} password`,
  text: ctx.defaultText,
  html: ctx.defaultHtml,
});
```

```ts
// zero/auth-emails/index.ts
import { defineAuthEmailTemplates } from '@zero/framework/server';
import { passwordResetEmail } from './password-reset';

export const authEmailTemplates = defineAuthEmailTemplates({
  passwordReset: passwordResetEmail,
});
```

```ts
// zero/auth.ts or inline createApp auth config
import { defineAuthConfig } from '@zero/framework/server';
import { authEmailTemplates } from './auth-emails';

export default defineAuthConfig({
  branding: {
    appName: Bun.env.APP_NAME,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
    brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
  },
  emails: authEmailTemplates,
});
```

Active template keys today are `accountSetup`, `passwordReset`,
`emailVerification`, `domainMailboxProof`, and `emailOtp`. The typed registry
also reserves `passwordChanged`, `mfaEnabled`, `mfaDisabled`, and
`recoveryCodesRegenerated` for MFA/account-notification slices.
`ctx.defaultSubject`, `ctx.defaultText`, and
`ctx.defaultHtml` let a custom template wrap or lightly edit the platform
default without copying the whole message body.

The `zero/auth.ts` and `zero/auth-emails/` paths above are app-owned module
conventions only. Import the resulting auth object into `zero.config.ts` (or
compose it directly before `createApp()`); the runtime does not discover those
modules automatically.

Email identities are canonicalized with `trim().toLowerCase()` during public
registration, admin creation/update, email-shaped login, and account recovery;
usernames remain case-sensitive. Lookups use that canonical identity and fail
closed if legacy rows contain an ambiguous canonical collision.

`POST /auth/forgot-password` always returns `{ ok: true }` after readiness is
established. It durably enqueues the same local work for every valid address
and does not wait for account lookup or the provider, so unknown, suspended,
cooldown, and delivery outcomes cannot change the public response. The default
UI therefore says: “If an account exists for that address, a reset link will
arrive shortly.” The background outbox creates action tokens just in time,
cleans them after failed attempts, retries transient failures with bounded
backoff, and recovers expired leases after restart. Privacy-safe observability
distinguishes delivered, suppressed, retried, and dead-letter outcomes without
recording the submitted address, native continuation, raw action token, or
provider error text. Public verification resend uses the same boundary.

If a provider may have accepted a request before its response was lost, Zero
uses at-least-once delivery: it revokes that attempt's token and retries with a
fresh token and per-attempt idempotency key. The user may receive an older
invalid message followed by the valid retry. Zero does not persist raw tokens
to avoid that edge case. If the process crashes before cleanup, lease recovery
still sends a fresh token instead of letting the crash-left token cooldown
suppress delivery. Both links may then work until a password transition or
email verification completes; both transitions advance the account security
generation and invalidate every sibling link and pre-transition session.
Queue caps bound local abuse; production should also
apply trusted-source rate limits for forgot-password and verification-resend at
the shared ingress, especially when several Zero replicas share traffic.
The built-in zero-configuration limits are 5,000 active jobs, 50,000 retained
rows, and 10 attempts per job; reaching them is privately suppressed behind the
same generic response. Graceful shutdown aborts and joins active delivery,
cleans its token, and returns the job to pending without spending an attempt
before the database lifecycle is released.

Reset/setup/verify tokens are opaque, stored only as hashes, bound to the
account's exact security generation, expire according to
`auth.accountEmails.actionTokenTTL`, are rate-limited by
`auth.accountEmails.requestCooldown`, and are consumed once. A later reset
cycle cannot resurrect an older link. Tokens issued by a pre-hardening Zero
version do not have the required identity/generation binding; resend any
pending setup, reset, or verification email after deploying the upgrade.

Login, refresh, auth middleware, and `requireAuth()` enforce account state:

| State | Behavior |
| --- | --- |
| `active` | Normal login and token use. |
| `active` with `passwordChangeRequired` | Login returns `PASSWORD_CHANGE_REQUIRED`; existing tokens no longer authenticate. |
| `active` with `emailVerificationRequired` and no `emailVerifiedAt` | Login returns `EMAIL_VERIFICATION_REQUIRED`; existing tokens no longer authenticate. |
| `suspended` | Login returns `ACCOUNT_SUSPENDED`; existing tokens no longer authenticate. |

## MFA

Zero has first-party MFA for email OTP and self-hosted authenticator/TOTP:

- `auth.mfa` config is normalized by `defineAuthConfig()` /
  `resolveAuthBehaviorConfig()`.
- `/auth/config` exposes public-safe MFA policy, enabled methods, readiness,
  and whether user choice/multiple methods are allowed.
- `/auth/admin/config` includes operational readiness such as email OTP
  readiness and whether the TOTP encryption secret is configured.
- `users.mfa_required` stores per-user/admin MFA enforcement.
- `_auth_mfa_methods`, `_auth_mfa_challenges`, and
  `_auth_mfa_recovery_codes` are framework-owned internal tables.
- `MfaMethodStore` persists the user's selected MFA method. For v1, the method
  the user enrolls becomes the active/preferred challenge method.
- `MfaService` keeps config/readiness response construction out of route
  handlers.
- `MfaChallengeService` owns setup/challenge policy, OTP delivery, TOTP
  verification, and method activation.
- Frontend auth components automatically route incomplete auth responses into
  shared MFA setup/challenge UI. Apps can also use `MFAEnrollmentForm`,
  `MFAChallengeForm`, `MFAContinuation`, `MFAManagementPanel`, and `QRCode`
  directly for account settings or custom auth pages.

Authenticator/TOTP is self-hosted by Zero. There is no external TOTP provider:
Zero will generate secrets, encrypt them at rest with
`AUTH_TOTP_ENCRYPTION_KEY`, create otpauth URLs, and verify authenticator codes
directly.

Required MFA does not issue app access/refresh tokens until setup or challenge
verification succeeds. Auth routes return short-lived transition tokens instead:

Migration `025` persists the resulting server-owned MFA assurance across
browser sessions and continuations plus native authorization-code and
refresh-session families. Existing rows are intentionally null: an upgrade never fabricates
proof. When `required` or `admin-required` policy applies, an unassured legacy
session or an invitation acceptance re-enters the normal setup/challenge flow;
verified completion propagates assurance into the replacement session family.

For `required` and `admin-required` policy, Doctor verifies that at least one
configured method is operational. Email OTP needs the same sender/provider
readiness as other auth email; TOTP needs `auth.mfa.totp.encryptionKey`. An
unavailable configured method is a warning when another method remains usable
and an error when required MFA has no usable method.

```txt
mfaSetupRequired: true
mfaSetupToken: "..."
```

or:

```txt
mfaChallengeRequired: true
mfaChallenge: {
  method,
  challenge,
  challengeToken
}
```

Clients use these routes:

```txt
GET  /auth/mfa/methods
POST /auth/mfa/setup
POST /auth/mfa/setup/verify
POST /auth/mfa/challenge/verify
```

`POST /auth/mfa/setup` accepts either a `setupToken` from registration/login or
an authenticated bearer token from account settings. Email setup sends a
six-digit code through the platform email provider and does not require
`app.publicUrl`. TOTP setup returns `{ secret, otpauthUrl, issuer, accountName }`
so the UI can render a QR code and verify the first authenticator code.

Account-settings setup is a profile ceremony and is bound to the exact live
web or native session that started it—not merely the same user. Its signed
verification token carries an opaque fingerprint of that session authority;
`POST /auth/mfa/setup/verify` must also present a bearer from the same live
session. Session revocation/expiry, tenant or membership generation changes,
advanced-role revision changes, an account security-generation change, or a
different concurrent login rejects activation with `AUTH_STATE_CHANGED` (409).
The browser SDK attaches the current bearer automatically for
`verifyMfaSetup()`. A custom client must preserve and send the originating
session bearer. Auth-flow setup that began from `mfaSetupToken` remains a
pre-session ceremony and does not require an existing bearer.

Official MFA routes carry the exact `authGeneration` proved by the preceding
password/session/transition boundary into challenge creation, method
activation, and final session issuance. `MfaChallengeService` keeps its
optional generation arguments only for source-compatible trusted-server calls
that do not bridge an earlier credential check; application ceremonies must
not use that fallback. Profile calls also pass a synchronous live-authority
admission callback, which is rechecked inside the enrollment write/activation
transaction. If email delivery or transition-token signing fails, exact
service-issued rollback receipts consume only the challenge and disable only
the still-pending method created by that attempt. A receipt mismatch fails
closed as `AUTH_STATE_INVARIANT_FAILED`; it never disables a newer or active
method.

`POST /auth/mfa/challenge/verify` exchanges a valid challenge token and OTP/TOTP
code for the normal access/refresh token pair.

For v1 MFA method selection, a user has one active/preferred method. If both
`email` and `totp` are enabled, enrollment lets the user choose one. Later
versions can allow multiple active methods and a "try another way" fallback
without changing the table shape.

Recovery-code storage is reserved for a later MFA slice. Keep
`auth.mfa.recoveryCodes` false until recovery-code generation, display, and
verification routes are added.

The root `.env.example` documents the common auth/email environment variables:
`APP_NAME`, `APP_PUBLIC_URL`, `APP_LOGO_URL`, `APP_SUPPORT_EMAIL`,
`AUTH_EMAIL_BRAND_COLOR`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_API_KEY`,
`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `AUTH_ACTION_TOKEN_TTL`,
`AUTH_BOOTSTRAP_SECRET`,
`AUTH_ACCOUNT_EMAIL_COOLDOWN`, `AUTH_MANUAL_PASSWORD_RESET`,
`AUTH_REQUIRE_EMAIL_VERIFICATION`, `AUTH_EMAIL_VERIFICATION_PATH`,
`AUTH_MFA_ENABLED`, `AUTH_MFA_POLICY`, `AUTH_MFA_METHODS`,
`AUTH_TOTP_ENCRYPTION_KEY`, and optional `AUTH_SIGNING_KEY`.

## Configured User Properties

Apps can configure known user property fields inline with `createApp()` today:

```ts
createApp({
  auth: {
    registration: { mode: 'admin-only' },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations', 'management'],
        editableBy: 'admin',
        useInPolicies: true,
      },
      notificationsEnabled: {
        type: 'boolean',
        default: true,
        editableBy: 'user',
      },
    },
  },
});
```

Configured defaults apply on public registration, first-admin bootstrap, and
admin user creation. Defaults are also lazily backfilled on login or `/auth/me`
without overwriting existing values.
Configured fields validate type/options and edit authority:

| `editableBy` | Meaning |
| --- | --- |
| `user` | Current user and admins may edit through platform routes. |
| `admin` | Admin routes may edit; current-user routes reject writes. |
| `system` | Only internal service/system calls should write. |
| `none` | Protected from user/admin platform routes. |

Unknown property keys remain allowed by default for compatibility and show in
the admin `UserManagement` additional-properties editor. Set
`strictUserProperties: true` to reject unknown current-user/admin property
writes through the platform routes and hide ad-hoc property editing from the
admin organism.

Set `useInPolicies: true` only on fields that backend authorization policies
may use as trusted claims. Zero rejects this flag on `editableBy: 'user'`
fields, so self-editable preferences such as `theme` or
`notificationsEnabled` cannot accidentally become access-control inputs. See
[Phase 5: Resource And Policy API Plan](../framework/phase-5-resource-policy-plan.md).

Changing or deleting a policy-trusted property through either official admin
property route—or through the generic admin user patch—revokes that user's
current sessions and advances their auth generation after the write commits.
The next HTTP request, workflow authority check, and Sync delivery therefore
re-resolve the new value. An idempotent trusted-property write and changes to
ordinary preference properties do not churn sessions.

`GET /auth/config` exposes only fields with `editableBy: 'user'` so public
account settings can adapt without leaking admin-only metadata policy. The
admin config endpoint exposes all configured fields for the `UserManagement`
organism.

```tsx
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  EmailVerificationForm,
  LoginForm,
  MFAEnrollmentForm,
  MFAManagementPanel,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@zero/framework/components/auth';

function LoginPanel() {
  return (
    <LoginForm
      forgotPasswordHref="/forgot-password"
      identifierAutoComplete="email"
      identifierLabel="Email"
      registerHref="/register"
    />
  );
}

function ResetPasswordPanel({ token }: { token: string }) {
  return <PasswordActionForm token={token} mode="auto" loginHref="/login" />;
}

function ResetPasswordPastePanel() {
  return <PasswordActionForm mode="reset" loginHref="/login" />;
}

function AccountSettings() {
  return (
    <>
      <UserPropertiesForm />
      <MFAManagementPanel />
      <ChangePasswordForm />
    </>
  );
}
```

`LoginForm`, `RegisterForm`, and `ForgotPasswordForm` read auth config by
default. Policy-aware links/forms wait for `/auth/config` before showing
registration or password-reset actions, hide unavailable actions, keep
first-admin bootstrap visible, and surface lifecycle errors such as
`PASSWORD_CHANGE_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, and
`ACCOUNT_SUSPENDED` with UI-friendly messages.
`useAuthConfig()` backs these decisions with one immutable, client-scoped
snapshot shared by every consumer. Its `unknown`, `loading`, `ready`, and
`error` statuses distinguish unavailable policy from a disabled capability;
`reload()` forces a fenced retry and resolves through state even when the
request fails. Imperative code can call `useAuth().getConfig()` against the
same shared controller; it publishes the same safe snapshot but rejects the
original current transport, server, or validation failure. A successful
`useAuth().register()` invalidates and reloads the snapshot because completing
first-admin bootstrap can change registration policy. The projection only
guides UI; server checks remain authoritative.
`RegisterForm` automatically switches to a check-your-email state when account
verification is required and exposes a resend action. When MFA policy is
optional and ready, it can request MFA setup during signup; required/admin MFA
is enforced by backend continuation responses.
When `/auth/config` reports `tenancy.mode: 'multi'`, the same form uses the
configured terminology. During bootstrap it renders a required tenant field
and sends it with any operator setup key. After bootstrap, registration remains
identity-only by default; `authenticated` creation adds an explicit “create a
new …” choice, while `platform-admin` and `disabled` do not pretend an ordinary
registrant can create one. The server derives the slug when omitted.
`EmailVerificationForm` handles `email_verification` tokens from email links,
can render a token-paste fallback when no query token is present, signs the
user in after a successful verification, and continues into MFA setup when the
verification token carries an MFA enrollment request or policy requires MFA.
`PasswordActionForm` inspects the emailed token first and only enables submit
when the token is valid and matches the requested `mode`. Omit `token` to show
a token-paste step before inspection. Password reset/setup commit the token,
password replacement, gate clear, and session revocation atomically, then clear
the page-session cookie and return
`{ user, passwordUpdated: true, signInRequired: true }`. They never start MFA
delivery or issue a new session after the password commit. The form shows a
success state and sends the user back to login, where normal MFA policy runs on
the fresh credential.
