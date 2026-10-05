---
id: zero.native-auth.broker-sync
type: architecture
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: single-owner-broker-and-native-sync
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

# Share One Native Session Owner And Bind Sync

[Native SDK index](./index.md) · [Documentation index](../../index.md)

A rotating refresh family must have one coordinated owner. Multiple independent
clients sharing one vault slot can replay each other's token and revoke their
own authority. A broker shares one client instead of giving every UI window
a separate credential manager.

## Framework Broker

createNativeAuthBroker(client) wraps one NativeAuthClient.
createZeroNativeAuthBroker(options) constructs the ergonomic client plus broker.
The broker single-flights initialization, refresh and sign-out, and supplies
revisioned state snapshots through request()/subscribeState().

```ts
import {
  createNativeAuthBroker,
  type NativeAuthClient,
} from '@zero/framework/native';

export function shareNativeOwner(client: NativeAuthClient) {
  return createNativeAuthBroker(client);
}
```

Broker request operations include state, initialize, refresh, signIn, signUp,
completeAuthorization, getAccessToken, signOut, listTenants and switchTenant.
Responses contain ok, snapshot and safe error/result fields.

This generic trusted broker is **not inherently a token-free untrusted IPC
protocol**. getAccessToken returns an access token; completeAuthorization accepts
a sensitive callback. If the UI must never see these, expose a smaller
host-defined allowlist, as the Rust/Tauri and Chrome adapters do.

## Broker Client

createNativeAuthBrokerClient({transport,serverUrl,...}) uses a host transport
with request(command,{signal?}) and subscribeState(listener). It implements
NativeAuthClient plus dispose(), validates response shape/revision and applies
new snapshots without trusting an older response to replace current state.

Request timeout defaults 30s, browser authorization timeout 960s.
The transport must validate sender identity, allowed operations and payloads.
A JavaScript type is not an IPC authorization guard. Do not forward an arbitrary
body into broker.request from a public endpoint.

The generic proxy supports getAccessToken and authenticated fetch using that
token. That is appropriate only when this consumer is inside the credential
trust boundary. Rust-only webview designs should use their narrow command
surface instead.

Dispose the proxy/subscriptions when the consuming host context is removed.
Do not create a second client to “recover” a dropped UI subscription while
leaving its previous refresh owner alive.

## Bind Zero Sync

createNativeSyncAuth(auth) returns the Sync getToken, refreshAuth and
bindAuthLifecycle hooks:

```ts
import {
  createNativeSyncAuth,
  type NativeAuthClient,
} from '@zero/framework/native';

export function nativeSyncOptions(auth: NativeAuthClient) {
  return {
    ...createNativeSyncAuth(auth),
    url: 'wss://app.example.test/sync',
  };
}
```

Merge the returned hooks into the normal Sync client configuration; this
fragment does not replace its table declarations or resource policies.
Refresh proof remains internal; Sync requests a current access token.

The lifecycle resets the old client on sign-out/non-authenticated state and
on subject/active-tenant change, and reconnects only when desired by the
connection lifecycle. It does not reconnect a manually disconnected client
merely because an unrelated state notification occurred.

Server Sync still admits the current user/membership, enforces read/write
and row policies and revalidates revocation. The client lifecycle is cache/
transport hygiene, not a substitute for server authorization.

## Failure And Verification

Test simultaneous consumers requesting refresh, sign-out while authorization
is pending, stale response revisions, malformed token/snapshot data, disposed
proxy callbacks and subject/tenant switches with visible rows. A broker channel
must not leak secrets through errors or diagnostic command logging.

## Related Guides And Next Steps

- [Framework client](./framework-client.md) owns the underlying session lifecycle.
- [Rust/Tauri](./rust-tauri.md) and [Chrome](./chrome.md) expose narrower UI protocols.
- [Guardian sessions](../guardian/sessions.md) explains replay/revocation semantics.
- [Reactivity](../../concepts/reactivity.md) distinguishes authority transitions from normal data updates.
