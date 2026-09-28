# Native auth integration recipes

These dependency-free factories turn a narrow platform bridge into Zero auth.
They are examples for the implemented TypeScript
`@zero/framework/native` entry point, not separate published SDKs. Use them
from a framework release that contains the native export.

The desktop factory requires a trusted JavaScript credential owner, such as an
Electron main process or a deliberately secured sidecar. It is not the normal
Rust-first Tauri path: Tauri's main process is Rust, and the standalone
`zero-native-auth` and `tauri-plugin-zero-auth` packages are functional private
`0.0.0` previews whose refresh session remains owned by Rust. They are not
published or production-certified, and still require audited host adapters for
the system browser, callback/deep-link handling, OS vault, and single-instance
lifecycle. The Svelte webview must not own the refresh session. See the
[SDK selection guide](../../docs/auth/app-auth-sdk-guide.md) before choosing a
host architecture.

Your app configuration remains publishable and small:

```ts
const auth = createDesktopAuth({
  serverUrl: 'https://app.example.com',
  clientId: 'example-desktop',
  host,
});

await auth.initialize();
await auth.signIn();
const account = await auth.fetch('/api/account');
```

`auth.signUp({ loginHint })` opens Zero's registration flow through the same
system-browser transaction and returns the normal Zero identity/session.

Both factories use Zero's process-wide `NativeAuthBroker`, so repeated setup
inside one JavaScript process reuses the credential owner for that storage
namespace instead of racing refresh rotation.

Register each example as a public client first. The client ID is visible by
design and there is no client secret:

```ts
auth: {
  nativeApps: {
    clients: [{
      clientId: 'example-desktop',
      name: 'Example Desktop',
      redirectUris: [
        'http://127.0.0.1/oauth/callback',
        'http://[::1]/oauth/callback',
      ],
    }],
  },
}
```

For mobile, add the one registered redirect URI:

```ts
const auth = createMobileAuth({
  serverUrl: 'https://app.example.com',
  clientId: 'example-mobile',
  redirectUri: 'https://app.example.com/oauth/callback',
  host,
});
```

## Desktop host bridge

Use [`desktop.ts`](./desktop.ts) for Electron or another desktop shell with a
trusted JavaScript host. A Tauri prototype can use it only from a separately
secured JavaScript sidecar with narrow IPC; running it in the Svelte webview
would put the credential owner on the wrong side of the trust boundary.
The trusted host process must:

- open the authorization URL in the user's system browser;
- bind an ephemeral port on `127.0.0.1` or `[::1]`, never a LAN interface;
- return a redirect such as `http://127.0.0.1:49173/oauth/callback`;
- accept one callback and close the listener; and
- map secret operations to Keychain, Credential Manager/DPAPI, or Secret
  Service—not renderer storage, a plain file, or an unencrypted database.

Register the matching portless loopback URI on the Zero server. Keep the
desktop IPC surface limited to the methods in `DesktopAuthHost`; do not expose
arbitrary shell, file, or credential-store access to a renderer.

Create the factory once at module/process scope. If the operating system can
start multiple copies of the application, add a tested single-instance or
cross-process lease before both copies can read the same rotating refresh
credential. The in-process broker cannot serialize separate processes.

## Mobile host bridge

Use [`mobile.ts`](./mobile.ts) with an OS browser-authentication session. Map
`openAuthSession` to APIs such as ASWebAuthenticationSession, Android Custom
Tabs plus verified App Links, or a tested Expo browser-auth bridge. Return the
final callback URL; Zero performs the state, issuer, redirect, PKCE, nonce, and
token checks.

React Native and Expo do not universally provide the complete Web platform
surface Zero and its JOSE verifier require. The recipe fails fast unless the
runtime has standards-compatible global `fetch`, `URL`, `TextEncoder`, and
WebCrypto with both `getRandomValues` and `subtle`. A crypto adapter for only
random bytes or hashing is not enough for ES256 ID-token verification. Install
and initialize a maintained runtime implementation before creating auth, then
test discovery, ES256/JWKS validation, refresh, and cold-launch callbacks on
every supported OS/runtime combination. Expo Go compatibility is not implied.

Map secret operations to Keychain or Keystore-backed encrypted storage. Prefer
a claimed HTTPS Universal/App Link. A unique private-use scheme is supported
when claimed links are unavailable.

If the OS relaunches the app for a callback, initialize the same client and
finish the durable pending transaction before normal navigation:

```ts
if (launchUrl) await auth.completeAuthorization(launchUrl);
else await auth.initialize();
```

Never put a client secret, API key, refresh token, or signing key in an
installed app. `clientId` is intentionally public.

Only call `auth.fetch()` with the Zero app origin. It overwrites the
Authorization header, omits ambient cookies, rejects another origin, and
retries one 401 after serialized refresh. Do not extract an access token for
ordinary API calls.

## Multiple windows or processes

Keep `createDesktopAuth()` in the trusted main process. Wire its broker through
the narrow interfaces in [`broker.ts`](./broker.ts), then create a
`createNativeAuthBrokerClient()` proxy in each renderer/window. The proxy can
drive UI, authenticated fetch, and Sync without receiving the refresh token or
opening the OS vault. Forward broker snapshots unchanged so their monotonic
revision can reject delayed IPC responses. Dispose the proxy when the window
closes.

The broker proxy can request a short-lived access token for its authenticated
fetch and Sync implementation, so renderer compromise is still security
relevant. The bridge must not expose the refresh token, vault, arbitrary shell
operations, or arbitrary cross-origin fetch. Keep callback completion inside
the fixed broker protocol and let the SDK validate its exact target, state, and
issuer; never treat a callback URL supplied by UI code as trusted.

## Sync lifecycle

Do not pass only an access token to Sync. Use the complete adapter so sign-out
and account changes purge cached rows before another identity reconnects:

```ts
import { createNativeSyncAuth } from '@zero/framework/native';
import { createSyncClient } from '@zero/framework/sync/client';

const sync = createSyncClient({
  url: 'wss://app.example.com/sync',
  tables,
  ...createNativeSyncAuth(auth),
});
```

## Before shipping

Run Platform Doctor on the server configuration and test sign-in, sign-up,
email verification, MFA, recovery followed by fresh login, cancellation, cold
launch, refresh rotation, offline retry, sign-out, administrator revocation,
and account switching on every packaged target. Inspect IPC, analytics, and
crash output to confirm that tokens, authorization codes, callbacks, and PKCE
state are never recorded. The full contract is in
[Desktop, Mobile, and Chrome Extension Authentication](../../docs/auth/native-app-auth.md).
