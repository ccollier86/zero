# App Authentication SDK Guide

Use this guide to choose the correct Zero authentication surface for a web
app, desktop app, mobile app, Tauri app, or Chrome extension. All installed-app
options use the same Zero accounts and server-side authorization. The client
integration changes; roles, trusted user properties, resource policies, route
guards, session revocation, and Sync policy do not.

The complete provider, redirect, storage, and deployment contract is in
[Desktop, Mobile, and Chrome Extension Authentication](./native-app-auth.md).
This page is the shorter selection and onboarding path.

## Choose the client surface

| Application | Use now | Credential owner | Current status |
|---|---|---|---|
| Zero web app | Browser auth through `AppProvider` and the normal auth hooks | Browser auth client plus Zero's HttpOnly page session | Implemented |
| Electron or another trusted JavaScript desktop host | `@zero/framework/native` and the packaged desktop recipe | One trusted main-process `NativeAuthBroker`; OS vault for refresh state | Implemented in the current Zero source; ship only with a framework release that contains this entry point |
| JavaScript mobile shell | `@zero/framework/native` and the packaged mobile recipe | Native host bridge plus Keychain/Keystore-backed storage | Implemented core; every target runtime still needs real-device WebCrypto, browser-session, deep-link, and vault verification |
| Tauri with a Rust-owned backend and Svelte UI | Standalone `zero-native-auth` plus `tauri-plugin-zero-auth` preview | One Rust process owner; the webview receives secret-free state and narrow actions | Functional private `0.0.0` preview; host-supplied OS vault/browser/callback adapters and real-platform certification are still required |
| Chrome Manifest V3 extension | Standalone `@zero/chrome-auth` preview | One MV3 service worker; restricted Chrome extension storage | Functional private `0.0.0` preview; not released or production-approved |
| Firefox, Safari, or another browser extension | No Zero adapter yet | Platform-specific background owner | Not implemented |
| Swift, Kotlin, .NET, or another native language | Implement the documented Zero OIDC public-client profile, or wait for a supported SDK | One platform credential owner and OS vault | No first-party package yet |

Do not use the installed-app SDK inside a normal Zero web page. Do not put a
desktop/mobile refresh token in a renderer, webview, `localStorage`, ordinary
preferences, or a normal file. Do not add a client secret: installed apps are
public clients and cannot keep one confidential.

### Tauri boundary today

The Rust/Tauri repository implements strict Zero discovery, Authorization Code
with PKCE, callback/state/nonce/issuer and ES256 ID-token validation, refresh
rotation and recovery, tenant list/switch, bounded same-origin authenticated
HTTP, secret-free revisioned state, and a deny-by-default Tauri v2 command
surface. Tokens, PKCE material, raw callbacks, and arbitrary authenticated
requests remain on the Rust side.

The preview deliberately supplies adapter traits rather than claiming every
operating system is supported. A host must provide and audit its system-browser,
callback/deep-link, OS secure-store, and single-instance integration, then pass
a real packaged-platform lifecycle matrix. Do not move
`@zero/framework/native` into the Svelte webview; use one Rust controller and
grant only the exact generated Tauri command permissions required by a trusted
local window.

### Chrome boundary today

The Chrome adapter is a separate private preview. It wraps the implemented
`@zero/framework/native` contract, but it has no released framework peer range,
has not completed real-Chrome end-to-end testing, and has not received an
independent security review. Its repository tests use a fake Chrome API and an
inert framework fixture. Do not publish it from the Zero checkout or describe
it as an available registry package.

The preview supports Chrome Manifest V3 only. Its worker owns auth operations,
but Chrome storage is readable by privileged extension pages. Popup, options,
side-panel, and offscreen-document code and CSP are therefore inside the
credential boundary. Content scripts remain untrusted.

## Onboard an installed app

### 1. Prepare the Zero web account flow

The system browser uses the same Zero pages as the web app. Keep the configured
login, registration, verification, reset, setup-password, and MFA pages public
to the page router. Prefer Zero's packaged auth forms because they preserve the
validated native continuation through registration, verification, password
recovery, and MFA.

Configure email delivery and `app.publicUrl` before requiring email
verification or email MFA. Password reset changes the password and invalidates
sessions, but deliberately requires a new login before the native consent flow
can continue.

### 2. Register one public client per shipped application

Use a different client ID for independently shipped desktop, mobile, and
extension apps. A client ID identifies the build; it is not a secret.

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  app: {
    name: 'Acme',
    publicUrl: 'https://app.acme.example',
  },
  auth: {
    nativeApps: {
      clients: [
        {
          clientId: 'acme-desktop',
          name: 'Acme Desktop',
          redirectUris: [
            'http://127.0.0.1/oauth/callback',
            'http://[::1]/oauth/callback',
          ],
        },
        {
          clientId: 'acme-mobile',
          name: 'Acme Mobile',
          redirectUris: ['https://app.acme.example/oauth/callback'],
        },
        {
          clientId: 'acme-chrome',
          name: 'Acme Chrome Extension',
          redirectUris: [
            'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/zero-auth/callback',
          ],
        },
      ],
    },
  },
});
```

Register only redirects that a shipped build actually uses. Desktop loopback
registration omits the dynamic port. Mobile should prefer a verified Universal
Link or App Link. Chrome must use the exact stable extension ID returned by
`chrome.identity.getRedirectURL('zero-auth/callback')`.

### 3. Run configuration checks before starting client work

```sh
bun run doctor -- --config ./zero.config.ts --strict
```

Doctor validates the native issuer/public origin, client uniqueness and shape,
identity scopes, TTLs, redirects, and proxy admission policy. The first
file-backed start normally runs Zero's native-auth migrations because
`createApp()` defaults `migrate` to `true`; follow the normal migration backup
and review policy for an existing production database.

### 4. Wire the platform host

For the TypeScript native SDK, the host supplies three narrow adapters:

- a system browser opener;
- a callback session armed before the browser opens; and
- an OS-backed secure vault.

Start with the [packaged native integration recipes](../../examples/native-auth/README.md).
Use one `createZeroNativeAuthBroker()` per process and vault namespace. In a
multi-window JavaScript desktop app, keep it in the trusted main process and
give windows a `createNativeAuthBrokerClient()` over narrow, ordered IPC.

### 5. Keep authorization on the Zero server

Native access tokens resolve to the same current Zero principal as web tokens.
Existing authenticated endpoints and resource policy keep working; no parallel
desktop/mobile permissions database is needed.

```ts
// server/endpoints/account.ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET',
  path: '/api/account',
  auth: 'user',
  handler: ({ user }) => ({
    userId: user.userId,
    email: user.email,
    role: user.role,
  }),
});
```

Use `authContext.clientId` or `authContext.sessionKind === 'native'` only when
an endpoint genuinely needs client attribution. Do not replace role, trusted
property, ownership, or resource-policy checks with a client-ID check. The
current provider's OIDC scopes release identity claims only; they are not API
permissions.

### 6. Bind Sync to the full auth lifecycle

```ts
import { createNativeSyncAuth } from '@zero/framework/native';
import { createSyncClient } from '@zero/framework/sync/client';

const syncAuth = createNativeSyncAuth(auth);
const sync = createSyncClient({
  url: 'wss://app.acme.example/sync',
  tables,
  ...syncAuth,
});
```

Spread the whole adapter, including `bindAuthLifecycle`. It prevents an
unauthenticated cold-start socket, refreshes after an auth close, purges local
rows and pending mutations on sign-out or subject change, and reconnects only
for an authenticated identity. Supplying only the current access token is not
equivalent.

### 7. Exercise lifecycle failures, not only the happy path

Before shipping, test on every target:

1. Sign in and explicit denial/cancellation.
2. Registration with and without required email verification.
3. Optional and required MFA methods enabled by the server.
4. Forgot/reset password followed by the required fresh login.
5. App cold launch, deep-link delivery, worker suspension, and process restart.
6. Access-token expiry, refresh rotation, offline recovery, and replay failure.
7. Sign-out, administrator session revocation, suspension, and client removal.
8. Same-origin protected HTTP and row-filtered Sync access.
9. Account switching with no previous user's cached rows visible.
10. Crash reports, logs, analytics, and IPC traces containing no credentials or
    callback URLs.

## Release checklist by surface

### TypeScript desktop/mobile

- Pin a framework release that actually exports `@zero/framework/native`.
- Use a real OS vault and system browser; test every packaged target.
- Keep one credential owner per process and prevent multiple app processes from
  racing the same refresh token unless the host has a tested cross-process
  lease.
- Test the exact WebCrypto/JWKS surface on React Native or Expo; compatibility
  is not implied by a successful web build.

### Rust/Tauri preview

- Pin the exact preview revision; the crates remain private `0.0.0` packages.
- Supply audited OS secure-store, browser, callback/deep-link, and
  single-instance adapters; none are bundled by the platform-neutral core.
- Keep callback completion and arbitrary authenticated application requests in
  trusted Rust, outside the webview command surface.
- Complete real packaged-platform, dependency/security, ownership, license,
  compatibility-range, and release review before publication.

### Chrome preview

- Keep the package private until its framework peer contract is released.
- Require Chrome 116+ for session persistence and Chrome 140+ for opt-in local
  persistence.
- Use one module-scope worker owner, synchronous listeners, exact host
  permissions, and a strict extension CSP.
- Reject split incognito mode; never use `chrome.storage.sync` for credentials.
- Complete real-Chrome lifecycle tests and security review before publication.

## Next references

- [Native provider and SDK contract](./native-app-auth.md)
- [Auth system and account lifecycle](./README.md)
- [Platform configuration](../platform-configuration.md)
- [Platform SDK reference](../sdk-reference.md)
- [Native desktop/mobile integration recipes](../../examples/native-auth/README.md)
