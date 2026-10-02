# Guardian User API Keys

Guardian can issue finite, revocable API keys whose authority always follows a
real Zero user and the user's current application or organization scope. The
feature is disabled by default. Enabling it does not make an existing route
accept API keys: each app route must opt in through the ordinary declarative
authorization contract.

This is one authorization system, not a parallel role model. A key receives no
stored permission list. On every request Guardian resolves its live user,
security generation, tenant and membership state, and current simple-role or
advanced-RBAC assignments. Suspending the account or organization, removing
the membership, changing eligibility, revoking the key, or changing the
account security generation changes what the credential can do immediately.

This capability does not issue service-level or environment credentials, sign
requests with HMAC, or enforce an API-key IP allow/deny policy. Those are
separate security features, not implied by enabling Guardian user API keys.

## Enable The Capability

Configure user API keys inside the existing `auth` contract:

```ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  tenancy: 'single',
  authorization: 'simple',
  apiKeys: {
    enabled: true,
    selfService: true,
    administratorIssuance: true,
    defaultTTL: '30d',
    maxTTL: '90d',
    maxActivePerUser: 10,
  },
});
```

`apiKeys: true` is the compact user-facing mode: it enables authentication and
self-service for eligible users, while administrator issuance stays disabled.
Use the object form to enable authentication without self-service or whenever
the app needs an explicit management policy.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Enable user-bound API-key authentication and management routes. |
| `selfService` | `false` | Let an eligible user list, issue, rotate, and revoke keys for the user's current scope. |
| `administratorIssuance` | `false` | Let an authorized app, organization, or platform administrator issue and rotate keys for other eligible users. Administrators can still review and revoke keys when this is `false`. |
| `eligibleScopeRoles` | all otherwise eligible roles | Optional simple/advanced scope-role allowlist. Advanced keys are validated against the declared role registry at startup. |
| `defaultTTL` | `30d` | Lifetime used when an issue or rotation request omits `ttl`. |
| `maxTTL` | `90d` | Maximum requested lifetime. Durations use `s`, `m`, `h`, or `d`. |
| `maxActivePerUser` | `10` | Maximum unexpired, unrevoked keys for one user in one application/tenant scope; range `1..100`. |

`defaultTTL` must not exceed `maxTTL`, and `maxTTL` must still produce an
absolute expiry representable by JavaScript `Date` at startup. Guardian repeats
that checked-add bound inside issuance transactions. Invalid fields, duplicate
role entries, unknown advanced-mode roles, advanced roles that cannot be
assigned to customer organizations, and invalid duration or capacity values
fail startup.

The public `GET /auth/config` projection includes only the UI-safe capability
flags and displayable TTL/capacity values. It never returns the role allowlist,
raw secrets, hashes, or server-only policy state.

## Scope And Authority

The configured tenancy and authorization axes determine how a key is bound:

| Guardian profile | Key binding | Live authority |
| --- | --- | --- |
| `single/simple` | application + user | Current global/simple user role |
| `single/advanced` | application + user | Current application role assignments and declared permissions |
| `multi/simple` | exact customer organization membership | Current membership role in that organization |
| `multi/advanced` | exact customer organization membership | Current organization role assignments and declared permissions |

Multi-tenant keys cannot be issued for the protected Administration
Organization. Platform administrators may review and manage keys belonging to
customer organizations, but a customer key never becomes platform-control
authority. A key bound to organization A cannot select organization B or use a
membership in B.

`eligibleScopeRoles` is evaluated against live authority. In advanced mode, a
user with any eligible active role may receive and use a key. Removing the last
eligible role makes the key unavailable; restoring eligible authority makes it
usable again unless another permanent invalidation occurred.

## Opt A Route In

Existing routes remain session-only. Admit API keys explicitly on the same
declaration that states the route's role or permission requirement:

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET',
  path: '/api/reports',
  auth: {
    user: 'required',
    credentials: ['session', 'api-key'],
    permission: 'reports:read',
  },
  handler: ({ user }) => ({ requestedBy: user.userId }),
});
```

To create an API-key-only endpoint tied to the same live user/RBAC authority,
use `credentials: ['api-key']`. This is still a user credential, not a service
identity; a normal browser session will be rejected:

```ts
auth: {
  user: 'required',
  credentials: ['api-key'],
  permission: 'imports:write',
}
```

Credential constraints inherit monotonically through routers. A child route
cannot widen a session-only parent, and a parent that permits both session and
API-key credentials can be narrowed by a child.

Registered resources opt their HTTP CRUD and `/api/data` paths in through the
same `authorizationPolicy()` requirement:

```ts
export default defineResource({
  table: reports,
  exposure: 'all',
  realm: tenantRealm(),
  policy: {
    list: authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session', 'api-key'],
      permission: 'reports:read',
    }),
    create: authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session', 'api-key'],
      permission: 'reports:write',
    }),
  },
});
```

Custom resource callbacks cannot opt a credential class in implicitly because
Zero cannot statically inspect their intent. Use `authorizationPolicy()` for
API-key admission, then compose it with `allOf()`/`anyOf()` when additional
resource checks are needed. In an `allOf()`, one API-key authorization gate
dominates the whole policy because every child must pass. In an `anyOf()`,
**every** independently allowing branch must contain such a gate; a sibling
owner or custom branch cannot inherit admission from another branch. Include
`session` for a resource that is also used through browser/native Sync; the
WebSocket itself remains session-authenticated.

Legacy declarations such as `auth: 'user'`, `auth: 'admin'`, and structured
requirements that omit `credentials` keep their session-only behavior. Public
and optional routes do not expose an API-key identity merely because the
request supplied a valid key.

API-key admission currently belongs to explicitly declared HTTP app routes and
HTTP resource/data policies. Guardian auth/control-plane routes and the Sync
WebSocket remain session credentials. This prevents a user automation key from
silently becoming an account-management or general interactive-session token.

### Raw Elysia routes

Managed `createApp()` composition installs the application-local credential
resolver automatically. A deliberately raw Elysia composition must supply it
to Guardian middleware and declare `zeroAuth` on every accepting route:

```ts
import { Elysia } from 'elysia';
import {
  createAuthMiddleware,
  createAuthPlugin,
  getAuthRequestCredentialResolver,
  getAuthorizationKernel,
  getAuthStore,
  getTokenService,
} from '@zero/framework/auth';

const app = new Elysia()
  .use(createAuthPlugin({ db, apiKeys: { enabled: true } }))
  .use(createAuthMiddleware(getTokenService, {
    getRequestCredentialResolver: getAuthRequestCredentialResolver,
    getAuthorizationKernel,
    getPropertyStore: getAuthStore,
  }))
  .get('/api/reports', ({ authContext }) => ({
    requestedBy: authContext!.userId,
  }), {
    zeroAuth: {
      user: 'required',
      credentials: ['session', 'api-key'],
      permission: 'reports:read',
    },
  });
```

When a raw multipart route accepts API keys, pass the same authorization
dependencies to `createProtectedMultipartRequestGuard()`. This preserves
Zero's early rejection before Elysia parses or buffers the upload body.

## Present A Key

Use the one-time secret as a Bearer credential:

```sh
curl https://app.example.com/api/reports \
  -H 'Authorization: Bearer zero_ak_v1.<key-id>.<secret>'
```

The identifier and opaque secret are one token. Do not pass the key in a query
string, cookie, request body, or log field. TLS is mandatory outside local
development.

## Management Surfaces

All management endpoints require a current Guardian **session**. An API key can
never issue, rotate, enumerate, or revoke API keys. Responses use
`Cache-Control: private, no-store`, lists are cursor-bounded, and the raw secret
appears only in a successful issue or rotation response.

| Actor/scope | Routes |
| --- | --- |
| Current user | `GET/POST /auth/api-keys`, `POST /auth/api-keys/:keyId/rotate`, `DELETE /auth/api-keys/:keyId` |
| Single-app administrator | `GET/POST /auth/admin/users/:userId/api-keys`, `POST /auth/admin/api-keys/:keyId/rotate`, `DELETE /auth/admin/api-keys/:keyId` |
| Active organization administrator | `GET/POST /auth/tenant/members/:membershipId/api-keys`, `POST /auth/tenant/api-keys/:keyId/rotate`, `DELETE /auth/tenant/api-keys/:keyId` |
| Administration Organization operator | `GET /auth/platform/api-keys`, `GET/POST /auth/platform/tenants/:tenantId/members/:membershipId/api-keys`, `POST /auth/platform/api-keys/:keyId/rotate`, `DELETE /auth/platform/api-keys/:keyId` |

List routes accept `limit` from 1 through 100 and an opaque `cursor`. The
platform directory also accepts an optional `tenantId` filter. Do not parse or
manufacture cursors in app code. Every page also carries server-authoritative
`capabilities: { canIssue, canRotate, canRevoke }` for the exact actor, mode,
scope, target, configuration, and current target eligibility. Custom UI should
use those booleans for action presentation; mutation routes still reauthorize
inside their transaction.

Issue and rotation bodies have the same shape:

```ts
{
  label: 'nightly import', // 1..100 characters after trimming
  ttl: '14d',              // optional; bounded by maxTTL
}
```

Issuance/rotation permissions by profile are:

- `single/simple`: current global `admin`;
- `single/advanced`: `application.roles:manage`;
- organization administration: `tenant.members:manage` in the active customer
  organization; and
- platform administration: `application.users:manage` plus
  `application.tenants:read` in the Administration Organization.

Listing uses the corresponding `*:read` permission. In `single/advanced`, these
are the existing application-access permissions: `application.roles:read`
views safe users and their access credentials, while
`application.roles:manage` changes roles or credentials. Revocation is a
management mutation. `administratorIssuance: false` removes administrator
issue/rotation without preventing authorized review and revocation of existing
credentials.

## Browser SDK

The imperative SDK exposes mode-separated namespaces, which keeps a component
or control plane from accidentally using a route from another mode:

```ts
const issued = await client.apiKeys.self.issue({
  label: 'local CLI',
  ttl: '7d',
});

saveInSecretStore(issued.secret); // available only in this result

const page = await client.apiKeys.self.list({ limit: 25 });
if (page.capabilities.canRotate) {
  await client.apiKeys.self.rotate(page.apiKeys[0]!.keyId, {
    label: 'local CLI',
    ttl: '7d',
  });
}
if (page.capabilities.canRevoke) {
  await client.apiKeys.self.revoke(page.apiKeys[0]!.keyId);
}
```

Administrator namespaces are:

```ts
client.apiKeys.applicationAdmin.listUser(userId, { limit: 25 });
client.apiKeys.applicationAdmin.issueUser(userId, input);

client.apiKeys.tenantAdmin.listMember(membershipId, { limit: 25 });
client.apiKeys.tenantAdmin.issueMember(membershipId, input);

client.apiKeys.platformAdmin.list({ tenantId, limit: 25 });
client.apiKeys.platformAdmin.listMember(tenantId, membershipId, { limit: 25 });
client.apiKeys.platformAdmin.issueMember(tenantId, membershipId, input);
```

Each administrator namespace also provides `rotate(keyId, input)` and
`revoke(keyId)`. The transport waits for/restores the authenticated browser
session, sends requests with `no-store`, rejects malformed or private response
fields, and does not retain the one-time secret in its key list.

### React hook and optional components

`useAuthApiKeys()` is the lower-level state surface for custom UI. Its
discriminated mode selects the exact management namespace:

```tsx
const keys = useAuthApiKeys({ mode: 'self', limit: 25 });

const memberKeys = useAuthApiKeys({
  mode: 'tenant-admin',
  membershipId,
  limit: 25,
});
```

The hook exposes `apiKeys`, page state, `isAvailable`, server-projected
`canIssue`, `canRotate`, and `canRevoke`, loading/mutation/denial/error state,
`reload()`, `loadMore()`, `issue()`, `rotate()`, and `revoke()`. Its cache
boundary includes the current identity, live authorization revision,
management mode, and target. A tenant, identity, or RBAC revision switch clears
the previous result instead of flashing it into the new scope.

Zero's packaged API-key controls are standalone components. Import and place
them where the app's information architecture calls for them; Zero does not
inject them into a dashboard, account page, member row, or platform shell.
Apps may omit them entirely or build a custom interface over the hook/SDK.

```tsx
import {
  ApiKeyManagement,
  SelfApiKeyManagement,
  ApplicationUserApiKeyManagement,
  TenantMemberApiKeyManagement,
  PlatformApiKeyManagement,
} from '@zero/framework/components/auth';

// Account/security page chosen by the app:
<SelfApiKeyManagement title="Automation credentials" pageSize={20} />

// Beside an app-owned user detail view:
<ApplicationUserApiKeyManagement userId={user.userId} />

// Beside an organization member detail view:
<TenantMemberApiKeyManagement membershipId={member.membershipId} />

// Platform-wide review, optionally filtered to one customer organization:
<PlatformApiKeyManagement tenantId={selectedTenantId} />

// Exact platform-operated customer-member controls (including issuance):
<PlatformApiKeyManagement
  tenantId={tenant.tenantId}
  membershipId={member.membershipId}
/>

// The same contract is available through one discriminated component:
<ApiKeyManagement mode="self" />
```

Every component accepts `title`, `description`, `className`, and `pageSize`.
The mode-specific wrappers require only their target identifier. Public config
decides whether the feature can appear; each successful list response decides
which issue, rotation, and revocation controls appear for that exact view.
Server authorization still decides every mutation. The one-time-secret panel
blocks additional key actions until the operator reviews or copies the value and chooses
**Dismiss and clear from page**.
Dismissal removes the raw secret from the component's in-memory page state; it
cannot erase a value the operator has already placed on the system clipboard.
Changing identity, tenant scope, live authorization revision, or target
remounts the control and clears the previous authority's secret and list state.

The one-time panel uses the public
[`SecretField`](../frontend/secret-field.md) component. It starts masked, exposes
the non-sensitive `zero_ak_v1.` prefix and final four characters, and copies
the complete key through its built-in action. Reveal state resets for every new
issue or rotation. The raw value still exists in authorized browser memory
until dismissal, so masking is protection against accidental viewing—not an
authorization or persistence boundary.

If an explicit copy attempt fails because the browser clipboard is unavailable
or denied, the panel reveals, focuses, and selects the complete key for manual
copying. This fallback occurs only after the operator requests a copy.

Apps building a custom key screen can use the same display primitive without
reimplementing secret presentation:

```tsx
import { SecretField } from '@zero/framework/components/secret-field';

<SecretField
  label="One-time API key secret"
  value={issued.secret}
  visiblePrefix={11}
  visibleSuffix={4}
/>
```

`onCopied` receives no raw key. `onCopyError` receives a stable, secret-free
clipboard `Error`, and the component's built-in observability does not attach
the value. The application remains responsible for clearing its own `issued`
state after the operator finishes.

## Secret And Lifecycle Contract

The raw `zero_ak_v1...` value is generated from cryptographically random
material and returned exactly once. Guardian stores a SHA-256 digest, a
four-character display hint, and lifecycle metadata; a high-entropy API key
does not need a slow password hash. List, revoke, audit, and observability
surfaces never receive the raw secret.

Rotation is atomic: the old key is revoked and the replacement is inserted in
one ReactiveDB transaction. If replacement creation fails, the old key remains
unchanged. A successful rotation returns a new one-time secret.

Summary status has these meanings:

| Status | Meaning |
| --- | --- |
| `active` | Unexpired, unrevoked, generation-current, and backed by active eligible authority. |
| `expired` | The finite expiry time has passed. |
| `revoked` | Explicitly revoked or replaced by rotation. |
| `invalidated` | The user's security generation changed after issue; this key cannot become active again. |
| `unavailable` | User, tenant, membership, or role eligibility is currently inactive. Restoring the same authority may restore the key. |

Password/security transitions that increment the user's auth generation
permanently invalidate older keys. Tenant or membership suspension is
temporarily unavailable so an exact reactivation restores the same credential;
a retained membership removal also makes the key unavailable until an explicit
re-admission, while physically deleting the membership cascades the tenant-bound
row. Current authority is revalidated at request admission and again at
protected mutation/async commit boundaries.

`lastUsedAt` is operational metadata, not a synchronous audit of every request.
Guardian rate-limits durable last-used writes while still validating every
request.

## Persistence, Audit, And Operations

Migration `029_guardian_api_keys` creates the private `_auth_api_keys` table and
its lookup/expiry indexes. The table is not a registered Sync surface. Tenant
keys carry a composite foreign key to the exact `(membership, tenant, user)`
tuple, preventing mismatched identity bindings at the SQLite boundary.

Successful issue, rotation, and revocation mutations append Guardian
control-plane audit events in the same transaction. Operational success logs
run after commit. Authentication rejection logs use stable Zero observability
codes with a coarse reason and never include a key ID, user email, token,
digest, or request authorization header.

Back up the database before normal production migrations, inspect the
migration plan, and deploy the route policy change with the feature enablement.
Enabling the API-key capability without opting routes in is safe but does not
make a useful credential. Opting a route into `api-key` before every target
runtime has the Guardian resolver is a deployment ordering error and should be
avoided.

## Production Checklist

- Keep the capability disabled until the app has chosen which routes may
  accept user keys.
- Require narrow permissions on every accepting route; never treat possession
  as global administrator authority.
- Keep management endpoints session-only and place packaged controls only in
  session-authenticated UI.
- Show the raw secret once, copy it directly to a password manager or operating
  system secret store, then clear it from component state.
- Use short defaults and a finite maximum lifetime appropriate to the app's
  threat model.
- Revoke unused credentials and review `lastUsedAt`, expiry, scope, creator,
  and status from the correct administration surface.
- Never store keys in source, browser local storage, URLs, analytics, logs,
  screenshots, or ordinary application tables.
- Send keys only over TLS and redact `Authorization` at proxies and error
  reporting boundaries.
