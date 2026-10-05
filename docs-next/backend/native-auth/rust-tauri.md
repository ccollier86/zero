---
id: zero.native-auth.rust-tauri
type: how-to
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: rust-engine-and-tauri-host-boundary
maturity: preview
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

# Keep Tauri Authentication In Rust

[Native SDK index](./index.md) · [Documentation index](../../index.md)

The independent Rust workspace supplies `zero-native-auth` and
`tauri-plugin-zero-auth`. It is a private 0.0.0 preview, not a published
production-certified package. This guide describes source at child commit
3ad97adb366e3281c3621f83ed2c74ca690499b1, separately from the core framework
baseline.

The useful model for a Tauri/Svelte app is one Rust credential owner with a
token-free UI command surface. Svelte renders safe state and invokes fixed
application operations; it does not hold refresh/access tokens or receive an
arbitrary authenticated-fetch command.

## Assemble The Core

```rust
use zero_native_auth::{IdentityScope, NativeAuthConfig};

let config = NativeAuthConfig::builder(
    "https://app.example.test",
    "example-desktop",
)
.redirect_uri("http://127.0.0.1/oauth/callback")
.scopes([IdentityScope::Profile, IdentityScope::Email])
.storage_namespace_prefix("example.desktop")
.build()?;
```

This is a host configuration fragment inside a Result-returning Rust function.
Register the exact public client/callback on
[Guardian](../guardian/native-provider.md). A portless registered loopback URI
permits the host's concrete ephemeral port; other callback forms match exactly.

NativeAuth::new(config, NativeAuthAdapters) requires explicit implementations
of HttpClient, SecureStore, CallbackAdapter, SystemBrowser, EntropySource and
Clock. OsEntropy/SystemClock and the default-feature ReqwestHttpClient provide
the standard entropy/clock/bounded transport. Browser, callback and real OS
vault remain host responsibilities.

The workspace does not bundle macOS/Windows/Linux vault adapters, iOS/Android
keystore/browser adapters, loopback server, mobile callback router or
single-instance integration. The platform-neutral engine is implemented;
platform adapters must be assembled/audited before claiming that OS is
supported.

## Browser And Callback Lifecycle

initialize() restores/revalidates secure state.
begin_sign_in() or begin_registration() starts a local operation after capture
is armed and pending proof is durable; registration sends prompt=create to
Guardian. The begin call does not wait for the entire user's browser ceremony.

Trusted Rust routes the captured callback directly to
complete_authorization(&callback_uri). It validates callback, state/nonce,
issuer, PKCE/code, signature/audience/time/subject and bounded token output
before publishing an authenticated snapshot.

subscribe() supplies a Rust watch receiver; snapshot() provides current state.
Use one controller per vault namespace/process ownership. A second process
cannot safely consume the same rotating refresh token without explicit
coordination.

Cancellation uses the current opaque operation ID, not a raw OAuth request
or callback. Timeouts and superseded lifecycle work cannot publish an old
authenticated snapshot after logout/replacement.

## Safe State

AuthSnapshot has wireVersion 2, monotonic revision and discriminated state:
uninitialized, anonymous, authorizing, authenticated or error.
Authenticated contains a fixed sanitized user and optional activeTenant;
authorizing/error may contain previousUser for display only.

previousUser is not authenticated authority. activeTenant requires the known
kind organization/administration; legacy stored tenant snapshots are refreshed
into a valid current envelope rather than assigned a guessed kind.

Snapshot/IPC exclude bearer/refresh, verifier/state/nonce, raw callback,
secure-store records, arbitrary claim maps and permission generations.
Safe error DTO contains code/message, not arbitrary adapter/provider text.

## Tauri Plugin And Permissions

Install Builder::new(auth).build() from tauri_plugin_zero_auth into one Tauri
v2 process. It manages one controller shared across windows; a duplicate
managed owner is rejected.

The generated commands are:

| Command | Input |
| --- | --- |
| state, initialize | No credential input. |
| begin_sign_in, begin_registration | Optional options containing loginHint. |
| cancel_authorization | operationId. |
| list_tenants | No refresh-token input. |
| switch_tenant | tenantId selector to validate server-side. |
| logout | No credential input. |

Commands use Tauri's `plugin:zero-auth|<command>` invoke names, for example:

```js
import { invoke } from '@tauri-apps/api/core';

const snapshot = await invoke('plugin:zero-auth|state');
await invoke('plugin:zero-auth|begin_sign_in', {
  options: { loginHint: 'person@example.test' },
});
await invoke('plugin:zero-auth|switch_tenant', { tenantId: 'tenant_123' });
```

These are UI lifecycle requests, not token-access or arbitrary HTTP commands.
The default permission set grants nothing. Grant only the needed generated
allow-* identifiers to an exact local bundled window, checking generated
identifiers against the pinned Tauri build. Do not grant remote origins or
wildcard windows by default.

No JavaScript guest package/ordered Tauri state channel is present in this
preview. UI can poll state or use a deliberate host-projected safe subscription.
Callback completion and authenticated domain requests remain Rust-only.

## Fixed Application Operations

Trusted Rust may call:

```rust
use zero_native_auth::ApiRequest;

let response = auth.execute(ApiRequest::get("/api/account")?).await?;
```

ApiRequest requires an origin-relative safe path, a bounded replayable body,
bounded response and noncredential headers. Body ceiling is 2 MiB; response
default 2 MiB, configurable up to 8 MiB. It rejects Authorization/Cookie/Host
in caller headers and does not follow redirects. A 401 permits at most one
serialized refresh/retry.

An app-owned Tauri command should choose a fixed domain operation and return a
sanitized domain DTO. Do not expose a UI-selected arbitrary URL/path/body
gateway into NativeAuth::execute.

## Tenants And Logout

list_tenants()/switch_tenant() require discovered zero_tenant_sessions v1 and
send only the Rust-held refresh proof. Successful switch persists the replacement
family before publishing its safe activeTenant. Unsupported peers fail with
NATIVE_TENANT_BINDING_UNSUPPORTED without inventing tenant authority.

logout() clears local credentials and attempts bounded remote revocation;
a safe warning can accompany a local anonymous outcome. Retire domain caches
and pending UI results when the owner changes.

## Verify The Host, Not Just Mocked Protocol

The child deterministic suite covers OIDC proof attacks, refresh/switch
concurrency, corruption, cleanup and DTO redaction. It does not certify real
OS browser/vault/cold launch behavior.

Before distribution, verify each host's vault, callback, system browser,
single-instance namespace ownership, deny-by-default capability set,
registration/recovery/MFA and packaging lifecycle. The pinned child Rust
toolchain is 1.88; release ownership/license/compatibility and publication
remain explicit preview gates.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists builder defaults and limits.
- [Guardian provider](../guardian/native-provider.md) owns the server proof policy.
- [Framework broker](./broker-sync.md) is a different trusted TypeScript IPC surface.
- [Roadmap](./roadmap.md) separates OS adapters and guest tooling from implemented core.
