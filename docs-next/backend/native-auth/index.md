---
id: zero.native-auth.index
type: index
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: overview
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

# Native And Extension Authentication SDKs

[Backend systems](../index.md) · [Documentation index](../../index.md)

These clients authenticate against Guardian's existing native OIDC provider.
The public client ID is safe to distribute; the installed app never receives
a shared client secret or the server's signing/provider keys.

The server and clients are separate contracts. Register the client in
[Guardian's native provider](../guardian/native-provider.md), then choose the
runtime that should own credentials.

## Choose The Owner

| Client | Credential owner | Distribution status |
| --- | --- | --- |
| Framework TypeScript `@zero/framework/native` | Host-supplied secure vault/browser/callback runtime. | Framework public source surface. |
| Rust `zero-native-auth` + Tauri plugin | One Rust controller; UI receives safe command results. | Independent private 0.0.0 preview; host OS adapters not bundled. |
| Chrome `@zero/chrome-auth` | One MV3 service worker with Chrome storage. | Independent private 0.0.0 preview; real framework peer/release gates outstanding. |

The two ignored `sdk/` child repositories are not included in the framework
package or Zero create/update payloads. Do not tell an app to install them from
a registry as if 0.0.0 were a public certified release.

## Feature Guides

- [Framework client](./framework-client.md): public methods, host adapters,
  restoration, callbacks, tenant switching and authenticated fetch.
- [Broker and Sync](./broker-sync.md): one credential owner, explicit IPC trust
  and authorized realtime lifecycle.
- [Rust/Tauri](./rust-tauri.md): Rust-native engine, narrow deny-by-default
  commands and Svelte/webview integration responsibilities.
- [Chrome](./chrome.md): worker initialization, exact callback registration,
  token-free message bridge and storage trust tradeoffs.
- [Configuration](./configuration.md): complete client option/default and
  preview-package boundary reference.
- [Roadmap](./roadmap.md): adapters, release/qualification and future transport
  work that is not currently promised.

## Shared Boundaries

Use the external system browser for human login/registration/verification/MFA.
PKCE, state, nonce, issuer, audience and exact callback validation belong to
the client engine. Host adapters must provide secure storage and correct
one-shot callback capture; a publishable client ID is not an OS vault.

Guardian owns current user/membership permissions and revocation.
A native identity profile or a UI role badge is not authorization for an API
or another tenant database. [Guardian sessions](../guardian/sessions.md) and
[tenant sessions](../guardian/tenancy.md) explain server authority.

The generic TypeScript broker can expose an access-token operation to trusted
consumers. Rust/Tauri and Chrome intentionally use narrower token-free UI
surfaces. Do not collapse these into an inaccurate promise that every generic
broker message is safe for an untrusted webview.
