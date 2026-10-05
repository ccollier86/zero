---
id: zero.native-auth.framework-client
type: how-to
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: public-typescript-client
maturity: supported
applies_to: ["2.1.1 framework source; independent SDK previews are not released"]
modes: [native-client, multi-tenant-native, desktop, extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
related_packages:
  - package: "zero-native-auth / tauri-plugin-zero-auth"
    version: "0.0.0"
    maturity: preview
  - package: "@zero/chrome-auth"
    version: "0.0.0"
    maturity: preview
---

# Use The Framework Native Client

[Native SDK index](./index.md) · [Documentation index](../../index.md)

`@zero/framework/native` supplies the platform-neutral TypeScript client.
It owns OIDC/PKCE, session rotation, callback validation and same-origin
authenticated fetch. It does not supply an operating-system keychain,
browser session or deep-link/loopback listener for every host platform.

## Construct With Explicit Host Adapters

```ts
import {
  createZeroNativeAuth,
  type NativeSecureVault,
  type NativeSystemBrowser,
  type NativeCallbackAdapter,
} from '@zero/framework/native';

// Host assembly fragment: adapters are implemented and audited by the host.
export function createInstalledAuth(
  secureStorage: NativeSecureVault,
  browser: NativeSystemBrowser,
  callback: NativeCallbackAdapter,
) {
  return createZeroNativeAuth({
    serverUrl: 'https://app.example.test',
    clientId: 'example-desktop',
    secureStorage,
    browser,
    callback,
    redirectUri: 'cc.example.desktop:/auth/callback',
  });
}
```

Register that client/callback on the [Guardian provider](../guardian/native-provider.md).
`createZeroNativeAuth` derives the /auth issuer from serverUrl.
The lower-level `createNativeAuthClient` accepts issuer, vault, browser and
callbacks directly. No client secret is accepted as a credential contract.

## Adapter Responsibilities

| Adapter | Required contract |
| --- | --- |
| NativeSecureVault | Async get/set/delete of issuer/client-bound secret storage. |
| NativeSystemBrowser | Opens validated authorization in the external browser; optional close. |
| NativeCallbackAdapter | prepare() arms capture before browser opens and returns a session. |
| NativeCallbackSession | Concrete redirectUri, waitForCallback(signal), dispose(). |
| NativeCryptoAdapter | Secure randomBytes and async SHA-256; WebCrypto default. |
| NativeFetch | Standard async Request/fetch shape; global fetch default. |

Refresh credentials and pending PKCE state belong in a real host secure store.
localStorage/plain preferences are not an interchangeable secure-vault adapter.
Only the host can establish OS permissions, callback ownership and browser
lifecycle guarantees; TypeScript structural typing cannot certify them.

## Restore, Sign In And Register

Call initialize() once through the owning runtime; it loads the stored session
and refreshes/revalidates before exposing it as authenticated. States are
uninitialized, anonymous, authorizing, authenticated and error.

signIn({loginHint?,signal?}) runs the external browser flow.
signUp() sends registration intent through the same server ceremony.
completeAuthorization(callbackUrl,signal?) supports trusted callback routing
when the host delivers a URI. Callback values are secrets; do not forward
arbitrary URI strings from untrusted UI as proof.

The flow arms callback capture, durably stores pending proof, then opens the
browser. The SDK validates the returned callback, code/state/nonce/issuer and
ID token. Returning from browser launch alone is not authenticated success.

Guardian may require verification, password recovery, MFA or tenant selection
inside the browser. The native client does not show a separate password form
that bypasses those policies.

## Observe Safe State

state includes validated identity claims, optional activeTenant and sanitized
error. subscribe(listener) returns an unsubscribe function.
getUser() returns identity claims or null, not refresh credentials.

getAccessToken() is a trusted runtime API and may refresh before returning a
usable access token. Refresh tokens have no public accessor. Do not expose
getAccessToken indiscriminately to an untrusted webview merely because the
framework client has the method.

Clear domain caches when subject/tenant/authenticated status changes. A new
revision is not permission to keep previous-tenant rows in an app store.

## Make API Calls

```ts
import type { NativeAuthClient } from '@zero/framework/native';

export async function readAccount(auth: NativeAuthClient) {
  const response = await auth.fetch('/api/account');
  if (!response.ok) throw new Error('Account request was not accepted');
  return response.json() as Promise<unknown>;
}
```

Authenticated fetch only targets the issuer's origin, attaches the current
bearer, omits ambient cookies and uses manual redirect handling.
A 401 causes at most one serialized refresh/retry; it does not loop indefinitely.
Server permissions/resource policies still enforce the app operation.

Use replayable request bodies and idempotency for mutations that can be retried.
A generic 401 retry is not a transactional guarantee for an arbitrary external
side effect. Another origin is rejected before sending credentials.

## Tenant Sessions

listTenants() uses the owner-held client refresh proof and returns safe choices.
switchTenant(tenantId) replaces the native family, validates/persists the
replacement and publishes the new activeTenant. Discovery must advertise
supported zero_tenant_sessions v1; do not invent endpoint names against a peer
without the capability.

Tenant switching and refresh are coordinated; conflicting switches do not
race independent refresh owners. Retire application results/subscriptions
before exposing the new tenant. Current permissions remain server-derived.

## Logout And Failure

signOut() supersedes pending local work, clears session/pending vault state and
attempts bounded remote revocation. It can reject with a safe failure even when
the UI is anonymous; a local storage failure is not proof the physical vault
was successfully emptied. Check the failure and host adapter rather than
declaring all credential cleanup succeeded from the state label alone.

Errors are NativeAuthError with safe code/message/status. Do not log provider
response bodies, refresh tokens, verifier, callback URI or vault envelope.
See [configuration](./configuration.md) for timeout/clock/namespace bounds.

## Verification

Use deterministic adapters to test cold restore, expired credential, callback
state/nonce/client mismatch, replay, cancellation, timeout, refresh single-flight,
tenant replacement, sign-out failure and stale lifecycle completion.
Then verify the real OS adapters/package/cold-launch matrix before claiming
platform support.

## Related Guides And Next Steps

- [Broker/Sync](./broker-sync.md) coordinates multiple consumers and realtime.
- [Configuration](./configuration.md) lists exact options/defaults.
- [Guardian provider](../guardian/native-provider.md) registers public clients.
- [Rust/Tauri](./rust-tauri.md) keeps a Svelte shell outside credential ownership.
