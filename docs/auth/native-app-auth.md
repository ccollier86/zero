# Desktop, Mobile, and Chrome Extension Authentication

Zero can authenticate installed desktop, mobile, and Chrome extension apps
against the same deployed Zero instance as a web app. The installed app is a
public OIDC client:
the user signs in through Zero in the system browser, the app receives a
short-lived authorization code, and the SDK exchanges it with PKCE. There is
no API key or client secret to ship inside the application.

Use this when an installed app needs the same Zero user identity, account
lifecycle, route guards, resource policies, and session revocation as the web
app. Native access tokens resolve to the normal Zero `AuthContext`; roles and
user properties remain the authorization source.

If you are choosing between the web, TypeScript native, Rust/Tauri, and Chrome
surfaces, begin with the [App Authentication SDK Guide](./app-auth-sdk-guide.md).
The important availability distinction is:

| Surface | Availability in this checkout |
|---|---|
| `@zero/framework/native` | Implemented TypeScript client and broker; use only from a framework release that includes this export |
| Packaged desktop/mobile recipes | Implemented narrow host factories distributed with the framework |
| `zero-native-auth` and `tauri-plugin-zero-auth` | Independent `0.0.0` design preview; configuration/state contracts only, with no working OIDC engine or platform adapters yet |
| `@zero/chrome-auth` | Independent private `0.0.0` MV3 preview; functional source, but no released framework peer range, real-Chrome release gate, or independent security review yet |

The standalone Rust/Tauri and Chrome repositories have their own Git history,
versions, and release gates. They are not included in `@zero/framework`, a
generated app, or `zero update`. This document is self-contained because a
normal Zero package or clone need not contain either development checkout.

## How the flow fits Zero auth

The installed app never collects the Zero password. It asks the operating
system to open `${app.publicUrl}/auth/oauth/authorize`, then the normal Zero web
account flow handles login, registration, required verification, password
recovery, MFA, and consent. The callback returns only an authorization code,
state, and issuer. The installed app exchanges the code with its one-time PKCE
verifier and stores the rotating refresh session in its platform vault.

The resulting bearer does not create a second kind of Zero user. HTTP auth
resolves the current database user and returns the usual `userId`, `email`,
and `role` auth context with native attribution added. Middleware and resource
policy rehydrate trusted user properties from the same user store when needed.
Resource CRUD, `/api/data`, app endpoints, middleware, and Sync continue to
enforce their existing server-side policy.

OIDC `profile` and `email` scopes control released identity claims only. They
do not grant route, table, mutation, administrator, or tenant permission.

## Server setup

Register each shipped application in `auth.nativeApps.clients`. Supplying a
non-empty `clients` array enables native auth; `enabled: false` explicitly
disables it.

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';
import { tables } from './app/db/schema';

export default defineZeroConfig({
  app: {
    name: 'Acme',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  },
  db: { mode: 'hot', path: './data/acme.db' },
  tables,
  auth: {
    nativeApps: {
      clients: [{
        clientId: 'acme-desktop',
        name: 'Acme Desktop',
        redirectUris: [
          'http://127.0.0.1/oauth/callback',
          'http://[::1]/oauth/callback',
          'https://app.acme.example/oauth/callback',
          'com.example.acme:/oauth/callback',
        ],
        scopes: ['openid', 'profile', 'email'],
      }],
    },
  },
});
```

`clientId` is an identifier, not a credential. It is expected to be visible
in the app binary, requests, and logs. Zero does not accept a native client
secret because an installed app cannot keep one confidential.

Register a different client for each independently shipped application. This
lets an administrator remove one distribution, rotate its redirect set, or
attribute requests without affecting another app. A client must have:

- a unique 1–128 character `clientId` using letters, digits, `.`, `_`, `~`, or
  `-`;
- a non-blank, already-trimmed display `name` shown on the consent page;
- at least one unique supported redirect URI; and
- a unique subset of `openid`, `profile`, and `email` that includes `openid`.

If `scopes` is omitted, all three identity scopes are allowed. The SDK adds
`openid` to its requested scopes automatically, but the server still requires
the registered client to allow it.

`app.publicUrl` must be a canonical HTTPS origin with no path, query,
fragment, or credentials. Local development may use `http://localhost`,
`http://127.0.0.1`, or `http://[::1]`. Native auth and protected Zero APIs use
one public origin in the current provider. An explicit issuer may spell out
that same origin's `/auth` endpoint, but it cannot point at a separate identity
host:

```ts
auth: {
  nativeApps: {
    issuer: 'https://app.acme.example/auth',
    clients: [/* ... */],
  },
}
```

The SDK derives the issuer by appending `/auth` to `serverUrl` unless the URL
already ends in `/auth`. Zero normalizes a same-origin explicit issuer and
rejects split issuer/API origins during Doctor and startup, so discovery,
authenticated fetch, and the access-token audience cannot disagree.

Optional server lifetimes default to `requestTTL: '15m'`, `codeTTL: '3m'`,
and `refreshTokenTTL: '30d'`. The SDK likewise waits up to 15 minutes for the
system-browser callback by default so registration and verification email can
finish inside the same pending authorization transaction.

The browser portion uses the app's configured `loginPath` and
`registrationPath` (`/login` and `/register` by default). In a
protected-by-default app, Zero's derived defaults include the normal login,
registration, verification, forgot/reset, and setup-password lifecycle routes.
An explicitly supplied `publicPaths` list is authoritative, so it must include
the configured/custom lifecycle paths. Doctor checks that page-router
configuration. Registration still obeys `auth.registration.mode`, email
verification obeys `auth.account`, and MFA obeys `auth.mfa`. Enabling a native
client never weakens those policies or creates a backdoor registration route.

For an existing file-backed deployment, enabling native auth introduces the
native request, code, session-family, and registration-intent tables through
the normal Zero migration sequence. `createApp()` runs migrations by default,
including a guarded backup for native-auth schema hardening. Review the normal
migration plan and backup policy against the correct production database before
deploying; do not use an app update command as a migration command.

Native authorize endpoints are public by design, so client IDs and redirects
cannot defend admission capacity. Global and per-client caps bound storage,
but an attacker can still spend those shared limits. Zero automatically keys
per-source limits from Bun's direct socket peer; spoofed forwarding headers are
ignored. That is secure without extra configuration for a directly exposed
Zero server.

Behind a reverse proxy, declare only the proxy address ranges Zero actually
trusts. Zero then walks `X-Forwarded-For` from the socket toward the client and
stops at the first untrusted address:

```ts
auth: {
  nativeApps: {
    requestAdmission: {
      trustedProxyRanges: ['10.0.0.0/8', 'fd00::/8'],
      maxAdmissionsPerSource: 20,
      rollingWindow: '1m',
    },
    clients: [/* ... */],
  },
}
```

An untrusted direct peer can never activate forwarded-header handling. A
malformed chain safely falls back to the socket peer. If your proxy emits a
different sanitized chain header, set `forwardedForHeader` alongside
`trustedProxyRanges`. The lower-level `sourceKey` callback remains available
for non-IP edge identities, but Zero rejects combining it with proxy settings
so there is one authoritative source policy. Universal `/0` proxy ranges are
rejected because they would let every direct peer activate forwarded headers.

Zero stores only a process-pseudonymous HMAC of the resolved source—not the raw
address. The HMAC key rotates on process restart, so it is admission control,
not durable analytics or an audit identity. Multi-replica deployments should
also enforce limits at their shared trusted edge because each Zero process
intentionally uses a different pseudonym key.

The built-in policy is bounded even when no tuning is supplied:

| Setting | Default | Meaning |
|---|---:|---|
| `requestAdmission.maxOutstandingGlobal` | 1,000 | Unconsumed authorization requests in this process/database |
| `requestAdmission.maxOutstandingPerClient` | 100 | Outstanding requests for one public client |
| `requestAdmission.maxOutstandingPerSource` | 20 | Outstanding requests for one resolved source |
| `requestAdmission.rollingWindow` | `1m` | Admission-counting window |
| `requestAdmission.maxAdmissionsGlobal` | 300 | New requests admitted per window |
| `requestAdmission.maxAdmissionsPerClient` | 60 | New requests for one client per window |
| `requestAdmission.maxAdmissionsPerSource` | 20 | New requests for one source per window |
| `refreshRotation.minRotationInterval` | `30s` | Minimum successful refresh spacing for one family |
| `refreshRotation.maxRotationsPerFamily` | 4,096 | Maximum replacements before the family ends |
| `refreshRotation.maxActiveFamiliesPerUserClient` | 10 | Active families retained for one user/client pair |

These are process/provider safety bounds, not a substitute for edge request
body limits, bot controls, or multi-replica rate limiting. Change them only
after measuring the expected number of installations, concurrent browser
flows, refresh cadence, and replica topology. The complete option table is in
[Platform Configuration](../platform-configuration.md#native-installed-app-authentication).

## Native SDK setup

The public native entry point has a Clerk-like facade. The host supplies only
the operating-system integrations; Zero owns discovery, PKCE, state and nonce
checks, ID-token validation, refresh rotation, authenticated fetch, and local
session state.

```ts
import {
  createNativeSyncAuth,
  createZeroNativeAuthBroker,
  type NativeCallbackAdapter,
  type NativeSecureVault,
  type NativeSystemBrowser,
} from '@zero/framework/native';
import { createSyncClient } from '@zero/framework/sync/client';

declare const systemBrowser: NativeSystemBrowser;
declare const callback: NativeCallbackAdapter;
declare const keychain: NativeSecureVault;

export const auth = createZeroNativeAuthBroker({
  serverUrl: 'https://app.acme.example',
  clientId: 'acme-desktop',
  browser: systemBrowser,
  callback,
  secureStorage: keychain,
  scopes: ['profile', 'email'], // `openid` is added automatically
});

await auth.initialize();
await auth.signIn({ loginHint: 'person@example.com' });

const me = auth.getUser();
const response = await auth.fetch('/api/account');
const syncAuth = createNativeSyncAuth(auth);

const sync = createSyncClient({
  url: 'wss://app.acme.example/sync',
  tables,
  ...syncAuth, // include token refresh and the cache-clearing lifecycle binder
});
```

Zero also ships dependency-free reference factories for a desktop loopback
bridge and a mobile browser-authentication session. Start with the
[native auth integration recipes](../../examples/native-auth/README.md), then
map their narrow host interfaces to your shell's system-browser and OS-vault
APIs. Once that bridge exists, each app supplies only `serverUrl`, its public
`clientId`, and—on mobile—the registered redirect URI.

`auth.fetch()` adds the access token, refreshes proactively, retries one 401
after a serialized refresh, and refuses to send credentials to another
origin. Use it for normal protected Zero routes. `getAccessToken()` exists for
integrations such as Zero sync, but do not persist or log the returned token.
The refresh token is intentionally never exposed by the SDK.

Spread the entire `syncAuth` object into a low-level `createSyncClient()`
config or `SyncProvider`. In addition to current-token lookup and serialized
refresh, its lifecycle binder clears local synced data on sign-out or account
change and reconnects only for an authenticated identity. Omitting that binder
can leave one user's cached rows visible after an account switch.

`createZeroNativeAuthBroker()` is process-shared by `storageNamespace`, so
multiple roots in one JavaScript process automatically reuse the same
credential owner. A conflicting configuration for an already-owned namespace
fails immediately instead of racing the vault.

Electron windows and other JavaScript renderer/main-process architectures must
keep the broker in their trusted main process and use
`createNativeAuthBrokerClient()` through a narrow IPC bridge. The proxy receives
state and, when required for authenticated fetch or Sync, short-lived access
tokens; it never opens the secure vault or receives the refresh token. Use the
packaged [broker IPC recipe](../../examples/native-auth/broker.ts) for the host
and client contracts. Dispose a proxy when its window or UI root is destroyed
so its state listener is removed. Preserve each broker snapshot's `revision`
unchanged across the bridge; the proxy uses it to ignore delayed state and token
responses after sign-out or another newer credential transition.

Tauri is different: its trusted main process is Rust, so it cannot directly
host this TypeScript broker. The standalone Rust/Tauri packages are still a
non-functional design preview. Do not instantiate the TypeScript credential
owner in the Svelte/webview UI. Until the Rust engine exists, a prototype needs
a separately secured JavaScript sidecar hosting this broker and narrow IPC, or
it should remain a web-only prototype. See the
[SDK selection guide](./app-auth-sdk-guide.md#tauri-boundary-today).

Other lifecycle calls are:

- `signUp({ loginHint })` opens the registration path in the system browser.
- `refresh()` explicitly rotates/refetches the session.
- `signOut()` attempts native-family revocation, clears local memory
  unconditionally, and reports any vault deletion or revocation failure.
- `subscribe(listener)` observes `uninitialized`, `anonymous`, `authorizing`,
  `authenticated`, and `error` states.
- `completeAuthorization(callbackUrl)` completes an authorization that
  relaunched the app instead of returning to the original process.

The public TypeScript surface is intentionally small:

| API | Contract |
|---|---|
| `createZeroNativeAuth(options)` | Creates one direct credential-owning client; suitable only when the caller itself is the trusted owner |
| `createZeroNativeAuthBroker(options)` | Preferred process-shared owner keyed by `storageNamespace`; rejects conflicting configuration |
| `createNativeAuthBrokerClient(options)` | Revision-ordered proxy over host-owned IPC; call `dispose()` when its window/root is destroyed |
| `initialize()` | Discovers the provider, reads the vault, and immediately rotates a stored refresh session before authenticating |
| `signIn()` / `signUp()` | Persists pending PKCE state, opens the system browser, waits for the armed callback, validates tokens, and commits the replacement session |
| `getUser()` | Returns validated ID-token identity claims, never server authorization policy |
| `getAccessToken()` | Returns a short-lived bearer for trusted integrations; never persist or log it |
| `fetch()` | Sends same-origin Bearer requests without ambient cookies or automatic redirects and retries one 401 after serialized refresh |
| `signOut()` | Clears local pending/session state, reports any cleanup/revocation failure, and leaves local state signed out |
| `createNativeSyncAuth()` | Supplies token, forced refresh, and cache/socket lifecycle binding to Zero Sync |

Every operation can reject with `NativeAuthError`, which exposes a safe
machine-readable `code`, message, and optional HTTP status. Provider response
bodies and tokens are not copied into those errors. Treat a rejected
`initialize()` or refresh according to the resulting auth state rather than
assuming the prior identity is usable: only `status === 'authenticated'` is an
authenticated session.

Temporary network/408/429/5xx refresh failures retain the stored session for a
later retry. An accepted but invalid response, `invalid_grant`, invalid client,
missing refresh rotation, or invalid persisted data fails closed. The provider
also revokes the whole family when a consumed refresh token is replayed.

Zero's packaged `LoginForm`, `RegisterForm`, `ForgotPasswordForm`,
`EmailVerificationForm`, and `PasswordActionForm` preserve a pending native
authorization through MFA, registration, verification resend, and password
recovery. A pending request is bound to the account once its identity is
known, so another signed-in user cannot approve it. Custom auth pages should
route successful browser auth back to the validated continuation:

```tsx
import { LoginForm, useNativeAuthContinuation, useRouter } from '@zero/framework/react';

const continuation = useNativeAuthContinuation();
const router = useRouter();

<LoginForm onSuccess={() => router.replace(continuation ?? '/app')} />
```

If the configured request lifetime expires, the account action can still
finish, but the installed app must start a new `signIn()` or `signUp()` call.

For cold-launch callbacks, create the same client and complete the saved
pending transaction before normal app navigation:

```ts
if (launchUrl?.startsWith('com.example.acme:/oauth/callback')) {
  await auth.completeAuthorization(launchUrl);
} else {
  await auth.initialize();
}
```

## Required platform adapters

`NativeSystemBrowser` opens the authorization URL using a browser security
context. Use the system browser or a platform browser-authentication session,
never an embedded webview. The adapter is deliberately unable to receive a
username or password.

`NativeCallbackAdapter.prepare()` must arm callback capture before it returns.
Zero calls it before opening the browser and uses the returned session:

```ts
interface NativeCallbackSession {
  readonly redirectUri: string;
  waitForCallback(signal?: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}
```

`NativeSecureVault` must use OS-backed secret storage. Appropriate adapters
include macOS/iOS Keychain, Windows Credential Manager or DPAPI-backed
storage, Android Keystore-backed encrypted storage, and Linux Secret Service.
Do not implement it with localStorage, plain preferences, an unencrypted
SQLite row, or a normal file.

The runtime must provide standards-compatible global `fetch`, `URL`,
`TextEncoder`, and WebCrypto with `getRandomValues` and `subtle`. Zero's JOSE
ID-token verifier depends on that global WebCrypto surface even when a
`NativeCryptoAdapter` supplies PKCE hashing and random bytes. React Native and
Expo do not guarantee this entire surface in every runtime; install and
initialize a maintained implementation before creating the client, then test
ES256/JWKS verification on every target. The packaged mobile recipe fails fast
when these globals are absent and does not imply Expo Go compatibility.

## Redirect choices

All redirects are registered ahead of time. Fragments, credentials, duplicate
query keys, and reserved response parameters (`code`, `error`,
`error_description`, `error_uri`, `state`, and `iss`) are rejected.

### Desktop loopback

Register IP-literal loopback URIs without a fixed port, then let the adapter
bind an available ephemeral port:

```txt
registered: http://127.0.0.1/oauth/callback
requested:  http://127.0.0.1:49173/oauth/callback
```

Register IPv4 and IPv6 separately when supporting both. Do not register
`localhost` as a callback and do not bind the listener to a LAN interface.
The adapter should accept one callback, verify the full URL through the SDK,
then close the listener.

### Mobile claimed HTTPS

Prefer a claimed HTTPS redirect such as
`https://app.acme.example/oauth/callback`. Configure the corresponding Apple
Universal Link or Android App Link association so the OS verifies that the
publisher controls the domain. Zero requires an exact URI match for these
redirects.

### Private-use scheme

When claimed links are unavailable, use a unique reverse-domain scheme with a
single slash, such as `com.example.acme:/oauth/callback`. Custom schemes can be
claimed by another installed app on some platforms, so claimed HTTPS is the
stronger mobile choice. PKCE and `state` still protect the transaction, and
Zero requires an exact URI match.

### Chrome extensions

A Manifest V3 extension uses Chrome's identity redirect instead of a loopback
listener or private-use scheme:

```ts
const redirectUri = chrome.identity.getRedirectURL('zero-auth/callback');
// https://<stable-extension-id>.chromiumapp.org/zero-auth/callback
```

Register that exact URI under a dedicated public client ID, for example
`acme-chrome-extension`. The extension ID is part of the redirect security
boundary, so keep it stable in development and use the Chrome Web Store ID for
production. Do not use a wildcard Chromium callback.

The separately versioned `@zero/chrome-auth` preview adapter owns the Zero
broker in the MV3 service worker and starts interactive authorization with
`chrome.identity.launchWebAuthFlow()`. Popups and side panels use a narrow,
revision-ordered message bridge; content scripts are rejected. The bridge does
not expose tokens or arbitrary fetches.

Chrome storage cannot isolate the vault from privileged extension-origin pages:
`TRUSTED_CONTEXTS` includes the worker, popup, options, side-panel, and offscreen
documents. Treat all such pages as credential-trusted, enforce a strict CSP,
and consider extension-page XSS a credential compromise. The worker boundary
prevents routine token transport and multiple SDK owners; it is not an OS-vault
boundary.

Use `chrome.storage.session` by default. It survives ordinary service-worker
suspension while clearing on browser restart, extension disable, extension
reload, or extension update. Persistent `chrome.storage.local` is a Chrome
140+ explicit opt-in with its access level restricted to `TRUSTED_CONTEXTS`;
it is not equivalent to an OS keychain. Never put credentials in
`chrome.storage.sync`.

The extension manifest needs only `identity`, `storage`, and an exact host
permission for the deployed Zero origin. Session mode supports Chrome 116+ so
an interactive `launchWebAuthFlow()` receives Chrome's strong service-worker
keepalive during longer registration, MFA, or verification flows. Local mode
requires Chrome 140+. Register listeners synchronously, reject manifest
`incognito: "split"`, and sign out with the prior configuration before changing
the server URL, client ID, storage persistence, or namespace. The adapter binds
those durable settings behind one extension-global ownership marker so a
configuration change cannot silently leave an older refresh family active.

## Provider endpoint reference

Use the SDK rather than assembling these requests in application UI. This
table documents the server contract for adapter authors, conformance tests, and
deployment diagnostics. With `app.publicUrl` set to
`https://app.acme.example`, the issuer is
`https://app.acme.example/auth`:

| Method | Issuer-relative path | Purpose |
|---|---|---|
| `GET` | `/.well-known/openid-configuration` | Capability and endpoint discovery |
| `GET`, `POST` | `/oauth/authorize` | Start/resume the system-browser request and submit the same-origin consent form |
| `POST` | `/oauth/token` | Exchange an authorization code or rotate a refresh token |
| `POST` | `/oauth/revoke` | Revoke the matching refresh-token family; unknown tokens remain an idempotent success |
| `GET`, `POST` | `/oauth/userinfo` | Return scope-filtered claims for a live native bearer |
| `GET` | `/jwks` | Publish the ES256 verification key set |

Discovery advertises response type `code`, response mode `query`, grants
`authorization_code` and `refresh_token`, public endpoint authentication
method `none`, PKCE method `S256`, ES256 ID tokens, authorization response
issuer parameters, and scopes `openid`, `profile`, and `email`. The current
discovery document does not contain a Zero profile-version extension. A
third-party client must validate every required advertised capability and pin
a tested compatible Zero framework release; it must not infer compatibility
from a future server accepting the same URL shape.

### Authorization request

The initial `GET /auth/oauth/authorize` accepts these protocol parameters:

| Parameter | Requirement |
|---|---|
| `response_type` | Exactly `code` |
| `client_id` | One registered public client |
| `redirect_uri` | One registered redirect; only an ephemeral loopback port may differ |
| `scope` | Space-delimited allowed identity scopes and always `openid` |
| `state` | One 32–512 character unreserved transaction value |
| `nonce` | One 32–512 character unreserved transaction value |
| `code_challenge` | Valid S256 PKCE challenge |
| `code_challenge_method` | Exactly `S256` |
| `response_mode` | Omit or use `query` |
| `prompt` | Omit for sign-in, `create` for registration, or `none` for a non-interactive probe that currently returns `interaction_required` |
| `login_hint` | Optional UI hint; never proof of identity |

`screen_hint=signup` is accepted as a registration alias when `prompt` is
absent. Duplicate protocol parameters, a `resource` audience, other prompts,
and scopes outside the identity set are rejected. The success callback contains
single `code`, `state`, and `iss` values. Error callbacks contain `error`, the
original `state` when safe, and `iss`. Clients must validate the exact callback
target, state, and issuer before exchanging the code.

Consent submission is a same-origin browser form protected by the page session
and Origin check. It is not a native SDK API. The request is bound to the Zero
user that claims its validated continuation so another already-signed-in
account cannot approve it.

### Token and revocation requests

`/oauth/token` and `/oauth/revoke` accept
`application/x-www-form-urlencoded` public-client requests. They reject any
`Authorization` header and any `client_secret` or `client_assertion` field.

Authorization-code exchange sends `grant_type=authorization_code`, `code`,
`client_id`, `redirect_uri`, and `code_verifier`. Refresh sends
`grant_type=refresh_token`, `refresh_token`, and `client_id`. A successful
result contains:

```json
{
  "access_token": "short-lived bearer",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "one-time rotating credential",
  "id_token": "validated identity JWT",
  "scope": "openid profile email"
}
```

The exact access lifetime follows the server's general `accessTokenTTL`; the
example shows the default 15 minutes. Every successful refresh returns a new
refresh token and ID token. Commit the replacement durably before publishing
authenticated state, and never reuse the old token. Revocation sends `token`,
`client_id`, and optionally `token_type_hint=refresh_token`; Zero revokes the
entire matching native family.

The access JWT has `aud` equal to the exact Zero app origin, while the ID token
has `aud` equal to the public native client ID. Both use the `/auth` issuer.
Those audiences are deliberately different, and current Zero does not support
a separate identity origin and API origin.

### UserInfo and normal Zero routes

UserInfo requires a live native Bearer token with `openid`. It always returns
`sub`; `profile` controls `preferred_username`, `name`, `given_name`, and
`family_name`; `email` controls `email` and `email_verified`. It re-reads the
current Zero user rather than treating the ID token as permanent profile state.

Normal Zero API routes remain on the app origin, for example
`https://app.acme.example/api/account`. Send the native access token as
`Authorization: Bearer ...`. Page cookies are not an API credential. The
TypeScript SDK's `auth.fetch()` enforces that origin, omits ambient credentials,
does not automatically follow redirects, and overwrites any caller-supplied
Authorization header.

## Identity scopes and application permissions

The current provider accepts only `openid`, `profile`, and `email`. This is
intentional: these are identity claims, not an application authorization
language. Do not invent OAuth scopes for application routes yet.

After token validation, Zero supplies the normal user id, email, and role plus
native attribution (`clientId`, `sessionKind: 'native'`, identity `scope`, and
the live session-family id). Middleware and resource policy re-read trusted
user properties from the same user store. Protect API routes and resources
with the same server-side auth and resource policies as browser clients. UI
checks are not security boundaries.

Suspending a user, changing security-sensitive account state, signing out,
removing the registered client, evicting the family, or detecting refresh-token
replay invalidates native access. Zero checks the current user generation,
client registration, and exact live family on every HTTP request, so even a
bearer copied outside the SDK stops working without waiting for JWT expiry. An
already-open Sync socket rechecks on its configured authorization interval (30
seconds by default). A separate service that verifies JWT signatures offline
cannot observe these database-backed decisions; route native traffic through
Zero or implement an equivalent live introspection/session check.

## Deployment checklist

1. Give production a stable HTTPS `app.publicUrl` or explicit `/auth` issuer.
2. Register a separate publishable `clientId` for each independently shipped
   app and exact redirect set.
3. On native apps, use the system browser and an OS secure-vault adapter. In a
   Chrome extension, use the Identity API and prefer session persistence.
4. Configure Universal/App Link domain association before selecting claimed
   HTTPS callbacks.
5. If Zero sits behind a proxy, configure its exact
   `requestAdmission.trustedProxyRanges`; use shared edge limits for a
   multi-replica deployment.
6. Run `bun run doctor -- --config ./zero.config.ts --strict`.
7. Review and back up the correct file-backed database before the normal native
   auth migrations run; never substitute `zero update` for a migration command.
8. Test sign-in, sign-up, denial/cancellation, verification, MFA, recovery,
   cold launch or worker restart, refresh rotation, sign-out, admin session
   revocation, account switching, Sync cache purge, and a protected API call on
   every supported OS or extension target.
9. Never place access/refresh tokens or the PKCE verifier in app-controlled
   URLs. Keep tokens, authorization codes, full callback URLs, and pending
   transaction material out of IPC logs, crash reports, analytics, and
   application logs.
10. Pin a Zero framework version whose discovery/SDK capabilities were tested
    together. Discovery currently has no Zero-specific profile-version marker.
11. Run `bun run test:package` in Zero before release; it packs the framework,
   installs it outside the checkout, and compiles both native adapter recipes.
   This does not replace real-device/runtime verification.
12. Do not release the standalone Rust/Tauri Phase 0 scaffold or private Chrome
    preview merely because their unit/package checks pass; complete their
    documented runtime, browser, security, and versioning gates first.

Doctor reports missing issuers/public URLs, enabled configurations without
clients, malformed proxy policy, malformed or duplicate client settings,
unsupported scopes, invalid lifetimes, and unsafe redirect URIs before
deployment.

## Standards and platform references

- [RFC 8252: OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)
- [RFC 7636: Proof Key for Code Exchange](https://www.rfc-editor.org/rfc/rfc7636.html)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [Apple: Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Android: App Links](https://developer.android.com/training/app-links)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome extension host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
