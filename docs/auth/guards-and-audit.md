# Auth Guards And Audit Boundaries

Zero has implemented request-scoped authentication and global-role guards. A
durable authorization/security control-plane trail is also implemented. A
general user-activity trail, audit-session files, and inactivity-driven session
expiration remain separate design ideas and are not current framework APIs.

## Current Runtime Contract

`createAuthMiddleware(getTokenService)` resolves session Bearer authentication
once for each HTTP request and adds the authorization facade plus three common
values to the Elysia request context:

- `authContext`: the current live `AuthContext`, or `null` when the request has
  no acceptable Bearer token;
- `requireAuth()`: returns the current `AuthContext` or throws a `401`
  `UNAUTHORIZED` error;
- `requireAdmin()`: returns the current `AuthContext`, throws `401` when there is
  no authenticated identity, or throws `403` `FORBIDDEN` when the current
  global role is not `admin`.

The two guard functions are request-scoped closures. They are not standalone
functions to import from `@zero/framework/auth`, and there is no
`src/auth/guards.ts` module. Destructure and call them inside a route handler:

```ts
app
  .get('/api/me', ({ requireAuth }) => {
    const auth = requireAuth();
    return {
      userId: auth.userId,
      email: auth.email,
      role: auth.role,
    };
  })
  .get('/api/platform-status', ({ requireAdmin }) => {
    const admin = requireAdmin();
    return { ok: true, requestedBy: admin.userId };
  });
```

Use `authContext` directly only when authentication is genuinely optional:

```ts
app.get('/api/greeting', ({ authContext }) => ({
  greeting: authContext ? `Hello ${authContext.email}` : 'Hello guest',
}));
```

Missing or invalid credentials deliberately produce `authContext: null`; the
middleware itself does not reject public routes. A protected handler must call
the appropriate guard, or use a higher-level Zero declaration that compiles the
same requirement.

When Guardian user API keys are enabled, managed `createApp()` composition also
installs the app-local credential resolver. A valid API-key identity remains
hidden on public, optional, legacy `user`/`admin`, and otherwise session-only
routes. The route must explicitly admit it:

```ts
export default defineEndpoint({
  method: 'POST',
  path: '/api/imports',
  auth: {
    user: 'required',
    credentials: ['session', 'api-key'],
    permission: 'imports:write',
  },
  handler: ({ user }) => ({ accepted: true, submittedBy: user.userId }),
});
```

Use `credentials: ['api-key']` for a user-bound machine endpoint that should
reject browser/native sessions. See [Guardian User API Keys](./api-keys.md) for
configuration, live scope semantics, management APIs, and client surfaces.

## Recommended App-Owned Routes

Package-mode applications should normally declare authorization on Zero
endpoints or routers:

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET',
  path: '/api/account',
  auth: 'user',
  handler: ({ user }) => ({
    userId: user.userId,
    role: user.role,
  }),
});
```

Use `auth: 'admin'` for a global-platform-admin endpoint. Raw Elysia plugins are
the advanced escape hatch; when using one, mount the auth plugin and middleware
and call the request-scoped guard in every protected handler.

Frontend gates such as `AdminGate`, `SignedIn`, and property gates are display
conveniences. They do not replace a server guard, resource policy, or Sync
policy.

## Protected Multipart Routes

Protected multipart requests are rejected during Elysia's `onRequest` phase,
before the framework parses or buffers the body. This matters for both security
and resource use: an invalid Bearer token does not need to be discovered only
after a potentially large upload has been consumed.

`defineEndpoint()` and `defineRouter()` install this early guard automatically
when their resolved auth requirement is `user` or `admin`. Router auth is
inherited by nested endpoints, and Zero matches the complete mounted prefix,
including parameter segments. The normal route authorization guard still runs
for every content type.

```ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/documents/parse',
  auth: 'user',
  body: t.Object({ file: t.File() }),
  async handler({ body, user }) {
    return {
      uploadedBy: user.userId,
      bytes: body.file.size,
    };
  },
});
```

No extra upload-auth adapter is needed for that endpoint. The official browser
client waits for auth restoration, sends the current Bearer token through Eden,
and retries one replayable `FormData` request after a successful refresh. Do not
set `Content-Type` manually; the browser must generate the multipart boundary.

Raw Elysia routes are the explicit escape hatch. Install the early guard before
the route and use the `zeroAuth` macro for normal route enforcement as well:

```ts
import { Elysia, t } from 'elysia';
import {
  createAuthMiddleware,
  createAuthPlugin,
  createProtectedMultipartRequestGuard,
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
  .onRequest(createProtectedMultipartRequestGuard(getTokenService, {
    requirement: {
      user: 'required',
      credentials: ['session', 'api-key'],
    },
    method: 'POST',
    path: '/api/documents/parse',
  }, {
    getRequestCredentialResolver: getAuthRequestCredentialResolver,
    getAuthorizationKernel,
    getPropertyStore: getAuthStore,
  }))
  .post('/api/documents/parse', ({ body, requireAuth }) => {
    const user = requireAuth();
    return { uploadedBy: user.userId, bytes: body.file.size };
  }, {
    zeroAuth: {
      user: 'required',
      credentials: ['session', 'api-key'],
    },
    body: t.Object({ file: t.File() }),
  });
```

Use matching requirements in the early guard and `zeroAuth`; otherwise the two
request phases would enforce different policy. Non-multipart and non-matching
requests pass through the early hook and reach ordinary route authorization.
Public multipart routes stay public. Early failures use the normal stable JSON
contract: `401 UNAUTHORIZED`, `403 FORBIDDEN`, or `503 AUTH_NOT_READY`.

Bearer hydration is memoized per `Request` and per app-local `TokenService`, so
root middleware, a nested router, the early guard, and the normal handler share
one live resolution without leaking identity between separate Zero apps. The
`getTokenService` convenience getter is suitable for an unambiguous standalone
composition; a process hosting multiple app runtimes must pass a getter for the
specific runtime instead. Zero-compiled `createApp()` routes already do this.

## Authorization Kernel

The server export includes the pure `AuthorizationKernel` used by Zero's
common policy vocabulary:

```ts
import {
  createAuthorizationKernel,
  resolveAuthBehaviorConfig,
} from '@zero/framework/server';

const config = resolveAuthBehaviorConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    permissions: {
      'patients:read': { label: 'View patients' },
      'patients:write': { label: 'Edit patients' },
    },
    roles: {
      clinician: {
        permissions: ['patients:read', 'patients:write'],
      },
      owner: {
        allPermissions: true,
        system: true,
      },
    },
  },
});

const authorization = createAuthorizationKernel(config);
const requirement = authorization.compile({
  user: 'required',
  tenant: 'required',
  permission: 'patients:read',
});

// `subject` must come from a trusted server session/scope adapter.
const decision = authorization.evaluate(requirement, subject);
```

`compile()` validates declared roles, permissions, and policy-trusted
properties. `merge(parent, child)` preserves every inherited constraint.
`evaluate()` returns an allow/deny decision with the compiled requirement,
validated scope, and stable denial reason; `authorize()` throws Zero's `401` or
`403` `AuthError` contract instead. `synthesizeSingleSimpleScope()` is a
compatibility helper for the exact `single/simple` profile.

The kernel itself deliberately does not load a user, tenant, membership,
token, or row. App-local adapters supply live server-owned authority. Managed
Elysia endpoints, `zeroAuth`, `defineEndpoint`, file-router layouts/pages and
`route.ts` handlers, request `context.access`, built-in service facades,
registered resource CRUD, `/api/data`, WebSocket Sync, and authenticated
workflow execution all consume that shared contract. Page-session identity is
accepted only on the safe page boundary; the router then evaluates the same
compiled requirement.

For registered app tables, use `authorizationPolicy(requirement)` in the
server-only `defineResource()` declaration. It accepts this exact requirement
shape and projects the current application or tenant assignment through the
same kernel for each exposed CRUD, lazy-read, and Sync surface. The independent
resource `exposure` value (`internal`, `http`, `sync`, or `all`) decides which
of those transports exists; policy cannot broaden it. Advanced roles are
therefore a live enforcement input, not UI metadata, and apps do not need a
parallel resource permission adapter.

## Low-Level Standalone Auth And Sync Composition

Most applications should use `createApp()`, which owns plugin order, database
lifecycle, auth middleware, Sync authentication, and platform policy. If a
standalone Elysia composition is necessary, `createSyncPlugin()` owns creation
of its `ReactiveDB`. Pass a `ReactiveDBConfig`, capture that exact instance with
the synchronous `onDatabaseCreated` hook, mount Sync first, then mount auth with
the captured database:

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

let db!: ReactiveDB;

const syncPlugin = createSyncPlugin({
  db: { mode: 'memory' },
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
      done: 'integer default 0',
    },
  },
  onDatabaseCreated(createdDb) {
    db = createdDb;
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

const app = installAuthStopBarrier(
  new Elysia()
    .use(syncPlugin)
    .use(createAuthPlugin({ db }))
    .use(createAuthMiddleware(getTokenService))
    .get('/api/me', ({ requireAuth }) => requireAuth())
    .get('/api/admin-check', ({ requireAdmin }) => ({
      adminUserId: requireAdmin().userId,
    })),
);

app.listen(3000);
```

Do not create a second `ReactiveDB` beside the one owned by the Sync plugin.
That splits auth rows, application rows, lifecycle, and policy evaluation across
different databases. Also remember that direct `createSyncPlugin()` composition
is public/allow-all unless the caller supplies both WebSocket auth and an
appropriate read/write policy; `createApp()` installs the framework-table
protections automatically.

## Other Authorization Surfaces

HTTP route guards do not automatically authorize every other transport:

- file-routed `route.ts` APIs are Bearer-only and inherit declarative
  `config.auth` from parent layouts;
- WebSocket Sync authenticates through `sync.auth`, then applies table,
  resource, and row policy separately;
- resources and `/api/data` evaluate their registered resource policies;
- page-session cookies authenticate only matched safe `GET`/`HEAD` page
  requests, not APIs, mutations, raw plugins, or Sync;
- current `role` and `requireAdmin()` checks remain legacy
  global-administrator concepts in every auth profile; they neither become
  tenant membership authority nor stand in for Administration Organization
  application permissions.

For Sync, use a `SyncPolicy` or the resource-policy integration. Do not treat an
HTTP `requireAuth()` call, a room ID, or a client-side filter as permission to
subscribe to a table or row.

## Durable Control-Plane Audit

Zero now records a bounded, append-only trail for its own authorization and
account-security control plane. Successful local mutations write their event
inside the same SQLite transaction. Platform administrators can query/export
all scopes; an active-tenant actor with `tenant.audit:read` can query/export
only its live tenant. Retention is bounded and explicit, and the raw internal
table is never exposed through Sync.

See [Durable Authorization and Control-Plane Audit](./control-plane-audit.md)
for the exact event contract, covered mutation inventory, retention config,
HTTP routes, SDK/hook/viewer, failure semantics, and deliberate exclusions.

This trail must not be confused with general activity tracking. Zero still
does not export `createAuditMiddleware`, `ActivityTracker`, `activityTracker`,
an automatic ReactiveDB `onQuery` read-audit hook, an audit-session API, or an
inactivity worker. Ordinary page/API/data reads and application CRUD are not
automatically recorded. A connected browser can remain idle without Zero
creating an audit session or applying an inactivity timeout.

An application-activity or compliance subsystem would still need an explicit
contract for sensitive-read instrumentation, session identity, multi-process
coordination, clock/restart behavior, foreground/background clients,
revocation races, independent custody, legal holds, and external integrity or
WORM guarantees. Applications needing those properties should forward the
bounded control-plane events and add app-owned domain/read events to an
independently controlled sink, then test that integration for their regime.
