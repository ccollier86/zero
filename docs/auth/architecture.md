# Architecture

One app-local auth runtime, one shared database. The Elysia auth plugin composes
focused identity, session, and optional tenancy services over the same
ReactiveDB the Sync engine uses; the transport-neutral authorization kernel
sits beside those runtime services until adapters install it at each boundary.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Elysia App                                  │
│                                                                      │
│  ┌────────────────┐   ┌───────────────────┐   ┌──────────────────┐  │
│  │  Auth Plugin    │   │  Auth Middleware   │   │  Sync Plugin     │  │
│  │                 │   │                   │   │                  │  │
│  │ POST /auth/*    │   │ derive authContext │   │ WS /sync         │  │
│  │ GET /auth/me    │   │ (live resolution) │   │ onChange→publish  │  │
│  │ GET /auth/jwks  │   │                   │   │                  │  │
│  └────────┬────────┘   └───────────────────┘   └────────┬─────────┘  │
│           │                                              │           │
│           │         ┌───────────────┐                    │           │
│           └────────►│  ReactiveDB   │◄───────────────────┘           │
│                     │  (shared)     │                                │
│                     │               │                                │
│                     │ users         │◄── private auth/API data       │
│                     │ user_properties│◄── direct SQL (composite PK)   │
│                     │ _credentials  │◄── internal (no broadcast)     │
│                     │ _refresh_tkns │◄── internal (no broadcast)     │
│                     │ _auth_config  │◄── internal (no broadcast)     │
│                     │ _auth_tenants │◄── internal tenant control     │
│                     │ _auth_tenant_memberships │◄── internal control │
│                     │ _auth_email_outbox │◄── durable auth delivery  │
│                     │ todos         │◄── broadcast (app table)       │
│                     │ _changes      │◄── internal (ring buffer)      │
│                     └───────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Auth Plugin (`auth.plugin.ts`)

Elysia composition root — owns plugin lifecycle wiring, shared auth error
mapping, global service derives, and subplugin registration.

**Owns:**
- Resolving auth behavior config once.
- Creating one app-local `AuthRuntime`, starting/stopping it from the Elysia
  lifecycle, and unregistering its compatibility provider during cleanup.
- Deriving that app-local runtime's auth services into global Elysia context.
- Mounting session, account, platform-admin, MFA, current-user property,
  authorization-snapshot, application-administration, tenant-administration,
  tenant-onboarding, verified-domain, control-plane-audit, and optional
  native-provider route plugins.

**Does not own:**
- Table definitions (that's `auth-schema.ts`).
- Service construction details (that's `auth-runtime.ts`).
- Registration, login, refresh, logout, password-change, or `/me` route bodies (that's `auth-session.plugin.ts`).
- Current-user property routes (that's `auth-user-properties.plugin.ts`).
- JWT verification on arbitrary routes (that's the middleware).
- WebSocket broadcast (that's the sync engine via ReactiveDB onChange).
- Application-specific resource policy (the shared requirement vocabulary,
  framework permission registry, and live evaluator are platform-owned).

### Auth Runtime (`auth-runtime.ts`)

Service lifecycle boundary for auth.

**Owns:**
- Creating the app-local account, token, property, email, MFA, request-admission,
  authorization, administration, onboarding, verified-domain, and audit
  services used by the auth route plugins.
- Creating one app-local `TenantStore`/`TenancyService` when resolved tenancy is
  `multi`; separate Zero apps do not share that service.
- Enabling SQLite foreign keys and calling auth schema setup at startup.
- Releasing app-local runtime resources at shutdown.
- Exporting typed getters used by auth subplugins and middleware.

### Tenancy Persistence (`tenancy/`)

The multi-mode persistence foundation is server-only. `TenantStore` owns
`_auth_tenants` and `_auth_tenant_memberships`; `TenancyService` exposes focused
create, lookup, membership, suspension/reactivation, role-change, and generation
operations without making an HTTP authorization decision.

The store enforces opaque IDs, canonical unique slugs, one retained membership
per tenant/user pair, active-owner invariants, and authorization-generation
bumps. Registration can call it inside `UserStore`'s provisioning transaction;
nested ReactiveDB transactions reuse the outer transaction, so user,
credential, tenant, owner membership, advanced owner assignment, and a durable
provisioning receipt are created together. The bootstrap marker is finalized
only after downstream email or session provisioning succeeds. The process owns
a bounded opaque receipt lease whose SHA-256 digest and expiry are stored; it
renews that lease before external provisioning. Failure removes the exact
receipt-bound graph atomically. Startup recovers only expired or legacy-unowned
receipts, rechecking under the writer lock, so another runtime's live work is
never mistaken for a crash. Direct `UserStore.createUser()` cannot close an
open multi-mode bootstrap without the organization-aware domain transaction.
An owner counts toward recovery only when the identity can receive a normal
token: active, not password-change-gated, and not awaiting required email
verification. Registration is the sole temporary exception. Its leased receipt
authorizes exact atomic creation/rollback; after delivery, an intent scoped to
the provisioned tenant (or the single-mode bootstrap owner) covers only the
pre-verification window. Migration 016 repairs all owner triggers to this
predicate and fails closed when existing state has no usable or exactly
registration-recoverable owner.

Tenant membership is now also the live authority for durable browser sessions.
Auth completion filters to active memberships whose tenants are active: one is
bound automatically, several produce an identity-only selection continuation,
and none produce onboarding-required without issuing app credentials. The
active-tenant member and role administration surface is packaged end to end;
see [Tenant member administration](./tenant-member-administration.md).
Hashed invitations and retained join requests are installed through the same
tenant/onboarding runtime and use commit-boundary authority revalidation.
Verified-company-domain onboarding is an opt-in evidence layer over those same
transactions: exact DNS control plus current mailbox possession can retain a
fixed-role join request, and reviewer approval still flows through the existing
membership, grant-ceiling, and RBAC services rather than a parallel admission
system. Owner-default claim release is likewise one control-plane transaction:
it retires proof/policy state, cancels pending derived requests, retains
provenance, and starts a seven-day cross-tenant quarantine.

### Auth Schema (`auth-schema.ts`)

Schema setup boundary for auth.

**Owns:**
- Creating/upgrading `users`, `user_properties`, `_credentials`,
  `_refresh_tokens`, `_auth_action_tokens`, `_auth_email_outbox`,
  `_auth_mfa_methods`, `_auth_mfa_challenges`, `_auth_mfa_recovery_codes`, and
  `_auth_config`.
- Delegating additive tenancy, durable-session, role-assignment, onboarding,
  native-provider, and provisioning-receipt tables to their focused schema
  modules and numbered migrations.
- Keeping raw SQL table setup out of route controllers.

### Built-in service data boundary

The app-local authorization runtime also owns the scope used by framework services.
Authenticated HTTP plugins derive a branded `ServiceDataScope` from the live request
`access` facade; callers never submit a tenant ID. `single` resolves to the historical
application scope, while `multi` requires a complete, live tenant membership and fails
closed for application/selection sessions.

Notifications and receipts, rooms and members, workflow instances/steps/events, and
Storage drives/objects/permissions persist the nullable discriminator added by migration
`008`. Child rows copy the parent's discriminator directly. Default framework Sync row
filters compare that column with the server-validated socket scope for snapshots, catch-up,
and live delivery. Durable state and ephemeral topics use the same scope in internal
principal/namespace keys so the same user may safely use the same logical key or topic in
two tenants.

Workflow definitions and handlers are application-global configuration. Notification
expiry cleanup, workflow polling/recovery, and the Storage content-addressed blob pool are
system-global scans; they do not create workflow authority. Migration `014` keeps each
workflow's original actor/session/scope generations (or an explicit audited system
principal) in a private MAC-protected seal. Dispatch, retry/recovery, and async output
commit revalidate that seal under SQLite write serialization, so revoked sessions,
suspended tenants/memberships, assignment changes, and stale handler attempts fail closed.
No bearer or refresh credential is persisted in workflow state. Signed
Storage URLs and upload grants are explicit bearer capabilities bound to one drive/path,
not ambient tenant membership.

The immutable multi-tenant permission registry includes `workflows:manage`,
`notifications:manage`, and `rooms:manage`. Tenant `owner`, any live tenant
scope with `allPermissions`, and app-defined roles assigned the matching
permission may administer that service in the active tenant. Workflow managers
may view and control peer workflows, notification managers may create targeted
notifications and inspect/delete them, and room managers may delete peer-owned
rooms. Ordinary workflow ownership, notification audience/receipt actions, and
room creator/member operations keep their narrower self-service semantics.

Global `users.role=admin` is the legacy global-administrator boundary, not
tenant data-plane or advanced application-permission authority, and never
supplies any of those permissions in `multi`. Administration Organization
application permissions likewise do not promote the identity's global role;
global-admin role mutation requires both boundaries where the route says so.
The same rule is shared by HTTP routes, request-scoped `zero.*` service
facades, and framework Sync row filters. `single` retains historical global
admin compatibility. Advanced role audiences always use the complete live
assignment set; the retained membership `role_key` and global platform role
are not implicit tenant roles.

### Auth Session Routes (`auth-session.plugin.ts`)

Elysia controller for core session and identity routes.

**Owns:**
- `/auth/config`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/me`, and `/auth/jwks`.
- Delegating MFA continuation decisions to `auth-mfa-response.ts`.
- Setting, rotating, revoking, or clearing the page cookie when session state changes.

### Auth Middleware (`auth.middleware.ts`)

JWT verification plus live user/session resolution — separate from the auth
plugin and applied as a cross-cutting concern.

**Owns:**
- Extracting Bearer token from `Authorization` header
- Verifying access token signature and expiry via TokenService
- Resolving `authContext` and auth guard helpers into Elysia context
- Starting Bearer hydration during `onRequest` for multipart requests so nested
  middleware and route guards share one request/service-scoped resolution
- Providing the raw-Elysia `zeroAuth: 'user' | 'admin'` macro and the early
  `createProtectedMultipartRequestGuard()` escape hatch

**Does not own:**
- Token issuance (that's `TokenService`, called by session/account/MFA routes)
- Access control decisions (that's each route — middleware just provides context)
- Refresh token handling (that's `auth-session.plugin.ts`)
- Page-session cookie authentication (that's `page-session.ts` plus the page router)

**AuthContext shape:**

```ts
interface AuthContext {
  userId: string;
  email: string;
  role: string; // platform/global role
  sessionId?: string;
  sessionKind?: 'web' | 'native';
  sessionScopeKind?: 'application' | 'tenant';
  sessionScopeId?: string;
  tenantId?: string;
  membershipId?: string;
  tenantRole?: string | null;
  authorizationAssignmentRevision?: string;
}
```

**Key design:** The middleware **does not throw while resolving identity**. It resolves `authContext: AuthContext | null` for unauthenticated requests and provides `requireAuth()` / `requireAdmin()` helpers for routes that need enforcement:

```ts
// Route that requires auth — throws if not present
.get('/api/me', ({ authContext }) => {
  if (!authContext) throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  return authContext;
})

// Route that optionally uses auth — works either way
.get('/api/public', ({ authContext }) => {
  return { user: authContext?.userId ?? 'anonymous' };
})
```

This keeps the middleware simple and pushes authorization decisions to the edge — the route handler that knows what it needs.

For protected multipart endpoints, enforcement begins earlier than the normal
`resolve`/`beforeHandle` path. Zero-compiled `defineEndpoint()` and
`defineRouter()` routes automatically install an `onRequest` guard for their
resolved `user` or `admin` requirement. That guard rejects invalid authority
before Elysia parses the body; the ordinary route guard still runs for all
content types. Public multipart routes are unaffected. Raw Elysia routes must
install the early guard explicitly in addition to declaring `zeroAuth`; see
[Auth Guards And Audit Boundaries](./guards-and-audit.md#protected-multipart-routes).

### Authorization Kernel (`authorization-kernel.ts`)

`AuthorizationKernel` is the pure, transport-neutral foundation for one policy
vocabulary. It is constructed from normalized tenancy, authorization, and
policy-trusted property config and can:

- compile legacy requirements (`false`, `user`, `admin`, and equivalents) or a
  structured requirement containing platform role, tenant, scope role,
  permission, and trusted-property constraints;
- merge parent and child declarations monotonically, so a child can add but not
  remove inherited requirements;
- validate serialized scope snapshots against the configured profile and
  declared permission/role ceiling; and
- return a deterministic decision with a stable denial reason, or throw the
  existing `AuthError` contract through `authorize()`.

The kernel owns no request, persistence, token, Elysia, tenant lifecycle, or
data-plane state. Installed adapters hydrate it from live durable authority for
the named Elysia request access facade, file routing, resources/data queries,
Sync, browser/page/native credentials, built-in services, and authorized
workflow execution. Raw application SQL and deliberately unsafe platform
handles remain trusted server-code escape hatches, and an unregistered app
table is not made tenant-safe by evaluating the pure kernel alone.

### Page Session (`page-session.ts`)

Server-rendered pages have a separate ambient credential. Completed auth flows
set a host-only, HttpOnly, `SameSite=Lax` cookie containing a signed page JWT
with `sub` and the backing refresh-session ID (`sid`). The page router resolves
it only after ruling out an actual `route.ts` handler and only for `GET` or
`HEAD`. Any explicit `Authorization` header remains authoritative.

Validation verifies the dedicated `auth-page-session` issuer, then requires an
active, unexpired `_refresh_tokens` row and a currently eligible user. Rotation,
logout, password changes, suspension, deletion, and admin session revocation
therefore invalidate SSR identity immediately. Global middleware, auth APIs,
server extensions, unsafe methods, and WebSocket sync remain Bearer-only.

### User Store (`user-store.ts`)

Stable facade for SQLite-backed identity operations. It prepares the
user/property/config statements it owns and coordinates focused internal
stores, each of which prepares and reuses its own statements. This keeps the
public `UserStore` API compatible without making one file own every auth
persistence concern.

**Owns:**
- User CRUD (create, read, update, delete)
- User properties KV (set, get, delete, list)
- Auth config storage (keypair persistence)
- Transaction/profile fencing and orchestration across its collaborators

**Coordinates:**
- `UserIdentityStore` for user identity CRUD, listing, and counts
- `UserPropertyConfigStore` for user properties and internal auth config KV
- `UserCredentialStore` for password hashes, compare-and-swap changes,
  password gates, revocation, and security audit coupling
- `UserTokenStore` for refresh tokens, replay/revocation, and legacy auth
  action tokens
- `RegistrationProvisioningStore` for receipt leases, finalization, crash
  recovery, and exact rollback
- `AuthGenerationStore` for durable per-user security generations

**Does not own:**
- Password hashing algorithm choice (uses `Bun.password` — the runtime decides Argon2id params)
- JWT logic (that's TokenService)
- Reactivity (that's ReactiveDB — UserStore writes through `db.insert()`/`db.update()`)
- Generic platform action/resume persistence (that's `PlatformTokenStore`)

Across auth persistence, any authority or lifecycle callback deliberately run
inside a managed database transaction is synchronous-only. A Promise-like
return has any later rejection consumed, fails closed with
`AUTH_STATE_INVARIANT_FAILED`, and rolls back that transaction; asynchronous
work must not escape the authority/commit fence.

### Token Service (`token-service.ts`)

Stable token and live-authority facade. It composes focused collaborators
instead of owning cryptography, signing-key establishment, and every browser
session-family transition in one file.

**Owns:**
- Live user, browser/native session, tenant, and profile-fence resolution
- Public issuance/verification/rotation/replacement methods and JWKS facade

**Coordinates:**
- `auth-signing-keys.ts` for atomic ECDSA P-256 key establishment/import
- `AuthTokenCodec` for strict JWT/JWKS cryptographic encoding and verification
- `AuthWebSessionTokenService` for refresh-family, page-session, replacement,
  rotation, and logout orchestration
- `AuthSessionService` and the stable `UserStore` facade for durable authority

**Does not own:**
- Token storage (refresh tokens use the stable `UserStore` facade, delegated
  internally to `UserTokenStore` and `_refresh_tokens`)
- User data (reads user claims from UserStore at signing time)
- HTTP transport (the plugin's routes call TokenService methods)

## Elysia Plugin Pattern

Same conventions as every other plugin in this codebase:

| Convention | Auth implementation | Existing precedent |
|------------|--------------------|--------------------|
| Factory function | `createAuthPlugin(config)` | `createIngestionQueuePlugin(getMemoryService)` |
| `onStart` / `onStop` lifecycle | Delegate to `auth-runtime.ts` for schema/services / cleanup | `persistence.plugin.ts` — init stores / dispose |
| `derive({ as: 'global' })` | Expose `authStore`, `tokenService` | `persistence.plugin.ts` — exposes `persistence` |
| Lazy getter export | `getAuthStore()`, `getTokenService()` | `getPersistenceColdStore()`, `getKnowledgeMemoryService()` |
| Named plugin | `new Elysia({ name: 'auth', prefix: '/auth' })` | `new Elysia({ name: 'persistence' })` |
| Route prefix | `/auth/*` routes scoped via plugin prefix | `session.routes.ts` — `/api/sessions` |
| TypeBox validation | `t.Object({ username: t.String(), ... })` on route bodies | All routes in `src/server/routes/` |

### Plugin Structure

```ts
// src/auth/auth.plugin.ts

export function createAuthPlugin(config: AuthPluginConfig) {
  const authConfig = resolveAuthBehaviorConfig(authBehaviorConfig(config));
  const runtime = createAuthRuntime(config, authConfig);

  return new Elysia({ name: 'auth', prefix: '/auth' })
    .onStart(() => runtime.start())
    .onStop(() => runtime.stop())
    .derive({ as: 'global' }, () => runtime.getContext())
    .use(createAuthSessionPlugin({ /* runtime getters */ }))
    .use(createAuthAccountPlugin({ /* runtime getters */ }))
    .use(createAuthMfaPlugin({ /* runtime getters */ }))
    .use(createAuthAdminPlugin({ /* runtime getters */ }))
    .use(createAuthUserPropertiesPlugin({ /* runtime getters */ }))
    .use(createAuthAuthorizationPlugin({ /* runtime getters */ }))
    .use(createAuthAuditPlugin({ /* durable control-plane audit */ }))
    .use(createAuthApplicationAdministrationPlugin({ /* single/advanced */ }))
    .use(createAuthPlatformAdministrationPlugin({ /* protected admin org */ }))
    .use(createAuthTenantAdministrationPlugin({ /* multi */ }))
    .use(createAuthTenantOnboardingPlugin({ /* multi */ }))
    .use(createAuthVerifiedDomainPlugin({ /* multi, when configured */ }))
    .use(createNativeAuthPlugin({ /* when configured */ }));
}
```

The production composition root also registers and unregisters the runtime's
legacy no-argument getter compatibility provider. New request handling remains
bound to the app-local `runtime` shown above rather than a process-global
singleton.

Managed composition likewise creates the Auth code emitter from that app's
observability runtime and passes it through lifecycle, request, native, email,
and background services. Direct standalone composition without a runtime keeps
the intentional process-wide compatibility emitter. The response redaction,
stable failure codes, and private-safe metadata contract is documented in
[Auth Operational Failure Contract](../observability.md#auth-operational-failure-contract).

### Plugin Config

```ts
interface AuthPluginConfig { // excerpt; it also extends AuthBehaviorConfig
  /** Shared ReactiveDB instance — auth defines its tables here */
  db: ReactiveDB;

  /** Access token TTL (default: '15m') */
  accessTokenTTL?: string;

  /** Refresh token TTL (default: '7d') */
  refreshTokenTTL?: string;

}
```

### Environment Variables

The current fallback names and defaults live in `AUTH_DEFAULTS` in
`src/auth/types.ts`. Explicit `auth.accessTokenTTL` and
`auth.refreshTokenTTL` configuration wins over the matching environment
fallbacks. Signing-key material is read from the environment by TokenService;
it is not an `AuthPluginConfig.signingKey` property.

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACCESS_TOKEN_TTL` | `15m` | Access token expiry (jose duration format: `15m`, `1h`, `2d`) |
| `REFRESH_TOKEN_TTL` | `7d` | Refresh token expiry |
| `AUTH_SIGNING_KEY` | *(auto-generate)* | Raw JSON or base64-encoded private JWK; PEM is rejected; overrides the DB-stored keypair |
| `AUTH_BOOTSTRAP_SECRET` | *(app convention; no implicit read)* | Recommended deployment-secret input passed to `auth.bootstrap.secret`; at least 32 characters |

## Data Flow

### Registration

```
Client                    Auth Plugin               UserStore           TokenService
  │                           │                         │                    │
  │  POST /auth/register      │                         │                    │
  │  { username, email, pw,   │                         │                    │
  │    bootstrapSecret?,      │                         │                    │
  │    organizationName? }    │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  preflight bootstrap    │                    │
  │                           │  (reject before hash)   │                    │
  │                           │  createRegistrationUser │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  Bun.password.hash │
  │                           │                         │  lock + recheck    │
  │                           │                         │  db.insert(users)  │
  │                           │                         │  credential store  │
  │                           │                         │  multi: admin org +│
  │                           │                         │  owner membership  │
  │                           │                         │  provisional       │
  │                           │                         │  receipt           │
  │                           │    UserRecord           │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  issueTokens(user)      │                    │
  │                           │ ────────────────────────┼───────────────────►│
  │                           │                         │                    │ sign JWT
  │                           │                         │                    │ gen refresh
  │                           │                         │  storeRefresh()    │
  │                           │                         │ ◄───────────────── │
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────┼────────────────────│
  │                           │  finalize receipt;      │                    │
  │                           │  mark bootstrap         │                    │
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken, user,    │                         │                    │
  │    tenant? }              │                         │                    │
  │ ◄─────────────────────────│                         │                    │
  │                           │                         │                    │
  │         ┌─────── Meanwhile, ReactiveDB onChange fires ──────┐           │
  │         │  db.insert('users', ...) records a change event   │           │
  │         │  Default createApp Sync policy denies user-table  │           │
  │         │  delivery; auth APIs return scoped projections.   │           │
  │         └───────────────────────────────────────────────────┘           │
```

In `multi` mode, `organizationName` is required for first-administrator
bootstrap and optional for later registrations; `organizationSlug` is optional
and otherwise derived on the server. During bootstrap, the user has
global/platform role `admin`; the protected tenant has
`kind: 'administration'`, and its membership has tenant role `owner`. Later
created organizations have `kind: 'organization'`. The initial
`createRegistrationUser()` transaction covers credentials, the Administration
Organization, membership, advanced role rows, any claimed native-registration
continuation, and a receipt in `_auth_registration_provisioning`. Session/token or
verification-email provisioning then runs outside the SQLite transaction. A
second transaction either finalizes the receipt and bootstrap marker or removes
the complete receipt-bound graph. Platform action tokens and native bindings
are cleaned as part of recovery, so provider/token failure cannot leave an
elected admin, orphan organization, or closed-but-empty installation behind.
The receipt is protected by a bounded lease: only the process holding the
opaque token can renew, finalize, or perform ordinary compensation, only the
digest is durable, and another runtime may recover it only after expiry. Lease
state is rechecked while holding SQLite's writer lock, which makes stale
finalization and concurrent crash recovery fail closed.
If delivery succeeds but verification remains pending, the receipt is removed
and the durable registration intent becomes the recovery proof. Multi-mode
intents are bound to the exact new tenant before the creation transaction
commits; consuming verification clears the intent in the same transaction that
makes the identity token-eligible. It cannot be used to provision or preserve a
different organization.

The returned registration `tenant` summary is additive and safe for display.
The actual app authority is the tenant-bound durable session created only after
all email/MFA gates complete. Every completion path uses the same rule: one
live membership auto-binds, several return selection-required, and none return
onboarding-required. A summary or continuation is never accepted as API
authorization.

### Login

```
Client                    Auth Plugin               UserStore           TokenService
  │                           │                         │                    │
  │  POST /auth/login         │                         │                    │
  │  { username, password }   │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  getUserByUsername()     │                    │
  │                           │ ───────────────────────►│                    │
  │                           │    UserRecord           │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  verifyPassword()       │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  Bun.password      │
  │                           │                         │  .verify()         │
  │                           │    boolean              │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  issueTokens(user)      │                    │
  │                           │ ────────────────────────┼───────────────────►│
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────┼────────────────────│
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken, user }   │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

### Request with Auth

```
Client                  Auth Middleware            TokenService          Route Handler
  │                         │                          │                      │
  │  GET /api/todos         │                          │                      │
  │  Authorization: Bearer  │                          │                      │
  │   eyJhbGci...           │                          │                      │
  │ ───────────────────────►│                          │                      │
  │                         │  resolveAuthContext(jwt) │                      │
  │                         │ ────────────────────────►│                      │
  │                         │                          │  verify signature,   │
  │                         │                          │  expiry + issuer;    │
  │                         │                          │  load current user,  │
  │                         │                          │  generation/session  │
  │                         │    current authContext   │                      │
  │                         │ ◄────────────────────────│                      │
  │                         │                          │                      │
  │                         │  derive: authContext =    │                      │
  │                         │  { userId, email, role } │                      │
  │                         │ ─────────────────────────┼─────────────────────►│
  │                         │                          │                      │ handle
  │                         │                          │                      │ request
  │  response               │                          │                      │
  │ ◄────────────────────────────────────────────────────────────────────────│
```

Cryptographic JWT verification is stateless, but request authentication is
not. `resolveAuthContext()` rehydrates the current user, checks account gates
and `authGeneration`, and validates the live refresh family for native tokens.
This makes suspension, password/security transitions, native sign-out, and
native refresh-replay revocation effective without waiting for JWT expiry.

### Token Refresh

```
Client                    Auth Plugin               TokenService          UserStore
  │                           │                         │                    │
  │  POST /auth/refresh       │                         │                    │
  │  { refreshToken }         │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  rotateRefresh(token)   │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  SHA-256(token)    │
  │                           │                         │  lookup hash       │
  │                           │                         │  in _refresh_tkns  │
  │                           │                         │  verify: exists,   │
  │                           │                         │  not expired,      │
  │                           │                         │  not revoked       │
  │                           │                         │                    │
  │                           │                         │  revoke old token  │
  │                           │                         │ ──────────────────►│
  │                           │                         │  (set revoked_at)  │
  │                           │                         │                    │
  │                           │                         │  issue new pair    │
  │                           │                         │  sign new JWT      │
  │                           │                         │  gen new refresh   │
  │                           │                         │  store new hash    │
  │                           │                         │ ──────────────────►│
  │                           │                         │                    │
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken }         │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

Old refresh token is always revoked — even if the new one is generated. One-time use.

### Logout

`POST /auth/logout` accepts an optional refresh token in
`{ refreshToken? }`. It does not require Bearer auth: logout must remain able to
expire the HttpOnly page cookie even when the access token and browser-managed
refresh token have already been lost.

```
Client                    Auth Plugin               TokenService          UserStore
  │                           │                         │                    │
  │  POST /auth/logout        │                         │                    │
  │  Cookie: page-session     │                         │                    │
  │  { refreshToken?: "abc" } │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  revoke optional raw    │                    │
  │                           │  refresh token and the  │                    │
  │                           │  cookie-bound session   │                    │
  │                           │ ───────────────────────►│  SET revoked_at    │
  │                           │                         │ ──────────────────►│
  │                           │                         │                    │
  │  Set-Cookie: expired      │                         │                    │
  │  { ok: true }             │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

The endpoint is idempotent. Possession of either credential only permits
revoking that same credential's backing refresh row; it cannot select another
user or session. The cookie is always expired in the response.

### Change Password

`POST /auth/change-password` requires auth (Bearer token). Takes `{ currentPassword, newPassword }` in JSON body.

```
Client                    Auth Plugin               UserStore
  │                           │                         │
  │  POST /auth/change-password│                        │
  │  Authorization: Bearer    │                         │
  │  { currentPassword,       │                         │
  │    newPassword }          │                         │
  │ ─────────────────────────►│                         │
  │                           │  verifyPassword(userId, │
  │                           │    currentPassword)     │
  │                           │ ───────────────────────►│
  │                           │    boolean              │
  │                           │ ◄───────────────────────│
  │                           │                         │
  │                           │  (if valid)             │
  │                           │  Bun.password.hash(     │
  │                           │    newPassword)         │
  │                           │  updateCredential()     │
  │                           │ ───────────────────────►│
  │                           │                         │
  │                           │  revokeAllUserTokens()  │
  │                           │ ───────────────────────►│  (force re-login)
  │                           │                         │
  │  { ok: true }             │                         │
  │ ◄─────────────────────────│                         │
```

After password change, all previous refresh-backed sessions are revoked. The
successful change-password response issues a fresh token pair and page cookie
for the current browser; other devices must log in again. Older JWTs can remain
cryptographically valid until `exp`, but Zero request authentication rejects
them immediately because the user's security generation changed.

### Session Expiration And Client Recovery

The implemented client recovery path is refresh-token based:

1. Access tokens are short-lived and stored only in memory.
2. Refresh tokens are opaque, stored hashed in `_refresh_tokens`, persisted by the browser SDK, and rotated on every refresh.
3. A signed HttpOnly page JWT is bound to the same refresh row and authenticates direct safe page requests during SSR.
4. Browser startup exchanges the stored refresh token for a fresh access token, then loads `/auth/me`.
5. Authenticated HTTP calls that receive 401 call `/auth/refresh` and retry once.
6. The sync WebSocket reads the current access token every time it opens or reconnects, so login/restore/refresh cannot leave sync using a stale token.
7. Logout, account or tenant replacement, rejected refresh, token replay, or
   an unrefreshable 401 crosses the browser authorization boundary: Zero masks
   and purges scoped Sync/state/ephemeral and hook data, rejects late response
   bodies, clears global overlays, and remounts or reloads the protected app
   subtree. App-owned caches use `useAuthorizationScopeBoundary()`.

`AppProvider` provides the default UI safety net. When auth is enabled and the
client becomes unauthenticated on a protected route, it removes protected route
content and redirects to `loginPath` with a `redirect` query parameter. The
server router uses the same route-auth mode, layout/page `config.auth`,
`publicPaths`, and `loginPath` settings during SSR/protected route handling.

Push-based inactivity messages over a personal `auth:{userId}` WebSocket topic
belong to the deferred user-activity audit system. They are not part of the
current auth runtime contract.

## Shared ReactiveDB

Auth and sync share a **single ReactiveDB instance**. This keeps identity and
application writes in one lifecycle and change sequence, but storage sharing
does not imply client visibility. Sync policy remains the authorization
boundary.

### Why shared

```
                     ┌─────────────────┐
                     │   ReactiveDB    │
                     │   (:memory:)    │
                     │                 │
  Auth writes ──────►│  users          │────── auth APIs
                     │  user_properties│      (not generic Sync)
                     │                 │
  Sync reads ◄───────│  todos          │────── policy filter
  App writes ───────►│  projects       │────── authorized clients
                     └─────────────────┘
```

When `authStore.createUser()` calls `db.insert('users', row)`, ReactiveDB writes
the row, increments `seq`, records the change, and invokes change observers.
Default `createApp()` policy classifies `users` as platform-private, so the row
is not available through snapshot, catch-up, or live generic Sync delivery.
Auth routes and the SDK session store expose the appropriate current-user or
admin projection instead.

App-owned tables can use the same database/change path for live delivery, but
only after the composed table/resource policy authorizes the connection and
row. A standalone `createSyncPlugin()` intentionally preserves its legacy
public-by-default contract; a directly composed auth app must supply required
WebSocket auth and read/write policy explicitly.

### Table ownership

Both plugins define tables on the same database, but each plugin owns its own tables:

| Table | Defined by | Storage class | Default client access |
|-------|-----------|---------------|-----------------------|
| `users` | Auth plugin | Platform/private | Auth current-user and admin APIs; denied by generic `createApp()` Sync |
| `user_properties` | Auth plugin | Platform/private direct SQL | Auth property/current-user/admin APIs; not a ReactiveDB table stream |
| `_credentials` | Auth plugin | Internal | None — password hashes stay server-side |
| `_refresh_tokens` | Auth plugin | Internal | None — token hashes are sensitive |
| `_auth_action_tokens` | Auth plugin | Internal | None — legacy reset/setup token hashes are sensitive |
| `_auth_tenants` | Multi-mode auth runtime | Internal/control plane | Purpose-built authenticated tenant/platform APIs only; no generic Sync access |
| `_auth_tenant_memberships` | Multi-mode auth runtime | Internal/control plane | Purpose-built authenticated member/onboarding/platform APIs only; no generic Sync access |
| `_zero_action_tokens` | Platform token plugin | Internal | None — generic action-token hashes are sensitive |
| `_zero_resume_tokens` | Platform token plugin | Internal | None — generic resume-token hashes are sensitive |
| `_auth_config` | Auth plugin | Internal | None — signing keys are sensitive |
| `todos`, etc. | Sync plugin (app config) | Application | Only when the composed Sync/resource policy allows it |
| `_changes` | ReactiveDB (auto) | Internal | None — server-side ring buffer for replay decisions |

### The `_` prefix convention

Tables beginning with `_` are internal and are never client-readable Sync
tables. Writes may still participate in server-side sequencing, but the engine
will not create client subscriptions for them. A table without `_` is merely
eligible for policy evaluation; the name does **not** make it public. The
default platform policy separately denies `users` and other private framework
tables and row-filters scoped framework tables.

### Password hash isolation

The `users` table contains no password hashes, but it still contains personal
and authorization-relevant data and is private by default. Password hashes live
in `_credentials`, an internal table that is not client-readable:

```sql
-- Platform-private identity record
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

-- Internal credential record
CREATE TABLE IF NOT EXISTS _credentials (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

Structural credential separation is defense in depth. It does not replace the
Sync policy that protects identity rows themselves.

## Composition

### Plugin ordering

```ts
import { Elysia } from 'elysia';
import {
  createAuthMiddleware,
  createAuthPlugin,
  getTokenService,
  installAuthStopBarrier,
} from '@zero/framework/auth';
import {
  createDefaultSyncPolicy,
  createSyncPlugin,
  type ReactiveDB,
} from '@zero/framework/sync';
import {
  createPlatformTokenPlugin,
  type PlatformTokenService,
} from '@zero/framework/tokens';

let db!: ReactiveDB;
let platformTokens: PlatformTokenService | null = null;
const sync = createSyncPlugin({
  db: { mode: 'memory' },
  onDatabaseCreated(created) { db = created; },
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
      done: 'integer not null default 0',
    },
  },
  auth: { required: true, getTokenVerifier: getTokenService },
  policy: createDefaultSyncPolicy({
    readProtectedTables: ['users'],
    writeProtectedTables: ['users'],
  }),
});
const tokenPlugin = createPlatformTokenPlugin({
  db,
  onServiceCreated(service) { platformTokens = service; },
});

const app = installAuthStopBarrier(new Elysia()
  // 1. Sync owns the shared ReactiveDB and WebSocket transport.
  .use(sync)

  // 2. Platform tokens use that exact database/transaction domain.
  .use(tokenPlugin)

  // 3. Auth uses the same DB and the app-local platform-token service.
  .use(createAuthPlugin({
    db,
    getPlatformTokenService: () => platformTokens,
  }))

  // 4. Middleware verifies JWTs and resolves live authContext per request.
  .use(createAuthMiddleware(getTokenService))

  // 5. App routes — can use both authContext and syncDB
  .get('/api/todos', ({ authContext, syncDB }) => { ... }));

app.listen(3000);
```

**Why this order:**
1. `createSyncPlugin()` constructs the one ReactiveDB during composition; its
   `onDatabaseCreated` callback makes that instance available to auth
2. Platform tokens mount on that exact instance before auth starts
3. Auth mounts on the captured database and lazily receives that app-local
   token service; a different transaction domain fails startup
4. Auth middleware comes after auth and resolves `getTokenService()` lazily
5. Direct Sync composition must explicitly require bearer auth and protect
   auth-owned tables; `createApp()` installs its broader platform policy
   automatically
6. App routes come last — they consume derived context from both plugins

### Shared DB injection

`createSyncPlugin()` accepts a `ReactiveDBConfig`, not a `ReactiveDB` instance.
Capture the instance it creates and pass that exact object to auth:

```ts
let db!: ReactiveDB;
let platformTokens: PlatformTokenService | null = null;
const sync = createSyncPlugin({
  db: { mode: 'memory' },
  onDatabaseCreated(created) { db = created; },
  tables: {},
  auth: { required: true, getTokenVerifier: getTokenService },
  policy: createDefaultSyncPolicy({
    readProtectedTables: ['users'],
    writeProtectedTables: ['users'],
  }),
});
const tokenPlugin = createPlatformTokenPlugin({
  db,
  onServiceCreated(service) { platformTokens = service; },
});

const app = installAuthStopBarrier(new Elysia()
  .use(sync)
  .use(tokenPlugin)
  .use(createAuthPlugin({
    db,
    getPlatformTokenService: () => platformTokens,
  }))
  .use(createAuthMiddleware(getTokenService)));

app.listen(3000);
```

Sync creates and owns the ReactiveDB; platform tokens and auth receive that
same instance. Do not create a separate ReactiveDB for either service, and do
not pass a ReactiveDB object as `createSyncPlugin({ db })`: that property is
database configuration. The action-token integration compares an opaque
transaction-domain identity, not paths or configuration, and throws
`AUTH_STATE_INVARIANT_FAILED` if direct composition crosses databases.

Shared action-token consumption and the corresponding credential/account
transition nest into one outer transaction. Their consumed-success events are
queued after commit; rollback discards both state and success telemetry. See
[Platform Tokens: Auth Transaction Boundary](../tokens.md#auth-transaction-boundary).

For most apps, prefer `createApp()`, which performs this composition, wires the
app-local token service automatically, and installs the complete platform
policy.

For standalone composition, apply `installAuthStopBarrier()` to the finished
root app. It makes `await app.stop()` join auth email delivery before Sync
disposes its database. `createApp()` installs its own full-platform
barrier and does not need this helper.

### WebSocket auth

The auth middleware derives `authContext` on HTTP requests only. WebSocket
connections use the sync plugin's explicit auth bridge: the browser sync client
sends the latest access token in a `sync.auth` message immediately after the
WebSocket opens. The server does not subscribe the socket or process sync
messages until it replies with `sync.auth.ready`. Keeping bearer tokens out of
the URL prevents them from being copied into proxy and access logs.

```ts
createSyncPlugin({
  db: { mode: 'app.db' },
  tables,
  onDatabaseCreated(created) {
    db = created;
  },
  auth: {
    required: true,
    getTokenVerifier: getTokenService,
  },
});
```

If the token is valid, sync resolves the current account and stores its auth
context on the socket. State Sync derives a server-owned application/user or
tenant/user principal; presence and managed ephemeral topics derive their own
authorized namespace from the same live identity. Invalid or missing
credentials close a required socket with code
`4001`. `createApp()` defaults sync to required whenever app auth is enabled;
an intentionally public app must opt in with `syncAuth: 'public'`.

The server revalidates authenticated sockets before inbound work and on a
short interval. Token expiry, suspension, forced password change, generation
revocation, or a change to property-derived table/row permissions closes the
socket and removes its subscriptions. Reconnect then performs a fresh auth and
policy evaluation. Legacy `?token=` handling exists only behind the sync
plugin's explicit temporary compatibility option and is disabled by default.

The sync engine's policy mechanism (see [Subscription And Mutation Policy](../realtime-sync/realtime-sync/README.md#subscription-and-mutation-policy)) uses the verified WebSocket identity when policy callbacks need user context. Auth provides `{ userId, email, role }`; sync derives readable tables through `SyncPolicy.canReadTable` and checks direct `sync.mutate` writes through `canMutateTable`, `canInsert`, `canUpdate`, and `canDelete`.

`createApp()` composes deny-wins platform defaults with app policy. `users`,
workflow definitions, and Storage metadata are private to generic Sync.
Notifications/receipts, rooms/members, and workflow instances/steps/events use
target, membership, or owner row filters across snapshot, catch-up, and live
delivery. Framework-owned tables are also protected from direct Sync mutation;
their purpose-built HTTP/service APIs remain the supported write path.

## Separation of Concerns

| Component | Knows about | Does NOT know about |
|-----------|-------------|---------------------|
| **ReactiveDB** | Tables, SQL, change events, `_` prefix convention | Auth, users, sync, WebSockets |
| **Sync Plugin** | ReactiveDB, WS connections, injected token-verifier contract, verified Sync auth context, topics, table/row policy | Passwords, refresh/session issuance, concrete JWT implementation |
| **Auth Plugin** | ReactiveDB, users, passwords, tokens | Sync, WS, broadcast, topics |
| **Auth Middleware** | JWT verification, `authContext` derivation | Users, passwords, refresh tokens, sync |
| **Request guards** | Request-scoped `authContext`, `requireAuth()`, and `requireAdmin()` | Password handling, refresh issuance, Sync policy |
| **Tenancy service/store** | Tenant and retained-membership persistence, generations, owner invariant | HTTP admission, token scope, route/data policy |
| **Authorization kernel** | Static registry, requirement compilation/merge, supplied subject/scope snapshots | Requests, sessions, database access, tenant switching, transport adapters |
| **Application** | All of the above — composes them | Implementation details of any component |

Each component does one thing. Auth doesn't know about WebSocket transport.
Sync does not handle passwords. ReactiveDB does not decide authorization. The
application layer composes them through the shared database and explicit
Elysia plugins. The bounded append-only authorization/control-plane audit is
part of this runtime. A general page/read/application-activity middleware or
tracker is not; its separate requirements remain deferred in
[Auth Guards And Audit Boundaries](./guards-and-audit.md).

## File Organization

```
src/auth/
├── user-store.ts           # Stable identity facade: users, properties, config, collaborator orchestration
├── user-identity-store.ts  # User identity CRUD/list/count persistence
├── user-property-config-store.ts # User properties and internal auth config KV
├── user-credential-store.ts # Password hashes and atomic password/security transitions
├── user-token-store.ts     # Refresh replay/revocation and legacy auth action-token persistence
├── registration-provisioning-store.ts # Receipt leases, finalize/recovery, exact compensation
├── token-service.ts        # Stable token and live-authority facade
├── auth-signing-keys.ts    # Atomic ES256 key establishment/import
├── auth-token-codec.ts     # Strict JWT/JWKS cryptographic codec
├── auth-web-session-token-service.ts # Browser refresh/page-session lifecycle
├── action-token-service.ts # Auth wrapper over generic platform action tokens
├── account-email-service.ts # Auth lifecycle email delivery through platform email
├── auth.plugin.ts          # Composition root — lifecycle, derive, subplugin mounting
├── auth-runtime.ts         # Service startup/shutdown and runtime getters
├── auth-schema.ts          # Table creation and compatibility upgrades
├── auth-session.plugin.ts  # Config/register/login/refresh/logout/me/jwks routes
├── auth-authorization.plugin.ts # Sanitized live browser authorization snapshot
├── auth-audit-service.ts / auth-audit.plugin.ts # Durable bounded control-plane audit
├── auth-user-properties.plugin.ts # Current-user property routes
├── auth-admin.plugin.ts    # Admin user-management routes
├── auth-application-administration*.ts # Single/advanced role administration
├── auth-platform-administration*.ts # Protected admin-org and customer-tenant control plane
├── auth-tenant-administration*.ts # Active-tenant member/role administration
├── auth-tenant-onboarding*.ts # Onboarding routes/config/codec/role policy
├── auth-tenant-invitation-service.ts # Invitation lifecycle
├── auth-tenant-join-request-{service,store,projection}.ts # Retained join requests
├── auth-verified-domain.plugin.ts / verified-domain-*.ts # Exact-domain request admission
├── auth-account.plugin.ts  # Forgot/reset/setup routes
├── auth-mfa.plugin.ts      # MFA setup/challenge routes
├── auth-mfa-response.ts    # Session-vs-MFA completion helper
├── auth-user-response.ts   # Public auth user response mapper
├── auth.middleware.ts      # Elysia middleware — resolves authContext + guards
├── auth-config.ts          # Auth config normalization
├── authorization-kernel.ts # Pure requirement compiler/evaluator
├── authorization-role-*.ts # Static roles, durable assignments, and provisioning/reconciliation
├── auth-bootstrap.ts       # Setup authorization + public-safe capability mapping
├── auth-context.ts         # Shared Authorization header extraction
├── auth-synchronous-callback.ts # Fail-closed guard for transaction-bound callbacks
├── tenancy/                # Tenant/membership schema, store, service, types
├── user-property-service.ts # Configured property validation/defaults
├── types.ts                # AuthContext, UserRecord, token/config/error types
└── index.ts                # Public API: all exports
```

See [Auth Guards And Audit Boundaries](./guards-and-audit.md) for the current
request-guard and durable control-plane-audit contracts, plus the separately
labeled future general-activity design.
