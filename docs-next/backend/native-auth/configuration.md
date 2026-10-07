---
id: zero.native-auth.configuration
type: reference
audience: [developer, agent]
owner: native-auth
status: verified
visibility: internal
system: native-auth-sdks
feature: client-options-and-preview-boundaries
maturity: supported
applies_to: ["2.6.0"]
modes: [native-client, multi-tenant-native, desktop, extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
related_packages:
  - package: "zero-native-auth / tauri-plugin-zero-auth"
    version: "0.0.0"
    maturity: preview
  - package: "@zero/chrome-auth"
    version: "0.0.0"
    maturity: preview
---

# Native Client Configuration Reference

[Native SDK index](./index.md) · [Documentation index](../../index.md)

Server registration and client runtime settings are different contracts.
[Guardian native configuration](../guardian/configuration.md#native-public-clients)
defines the issuer/client/callback allowlist and server TTL/admission policy.
This page defines only client options and adapter ownership.

Settings are read when constructing the client/worker/Rust configuration.
Changing issuer/client/namespace is a credential migration, not a live public
settings switch. No client secret or server signing key belongs here.

## Framework TypeScript Client

Public imports come from `@zero/framework/native`.

| NativeAuthClientOptions | Type/default | Responsibility |
| --- | --- | --- |
| issuer | Required HTTPS URL, loopback HTTP for development. | Canonical provider issuer; no credentials/query/fragment. |
| clientId | Required public identifier, 1–128 allowed ASCII characters. | Exact registered ID. |
| redirectUri | Optional string. | Passed to host callback preparation; must match server policy. |
| vault | Required NativeSecureVault. | OS-backed async get/set/delete. |
| browser | Required NativeSystemBrowser. | External browser open and optional close. |
| callbacks | Required NativeCallbackAdapter. | prepare arms a concrete callback session before browser open. |
| fetch | NativeFetch; global fetch. | Trusted/test network adapter, not a UI-selected provider. |
| crypto | NativeCryptoAdapter; WebCrypto. | Secure entropy and SHA-256. |
| scopes | Identity-scope array; profile+email, openid always added. | Optional phone/profile:write/contacts:write must be explicitly requested and allowed by server client policy; never app RBAC scopes. |
| storageNamespace | Optional string; issuer/client-derived. | Explicit value trimmed, 1–200, no controls; avoid colliding unrelated clients. |
| authorizationTimeoutMs | Positive finite number; 900000. | Browser/callback ceremony deadline. |
| networkTimeoutMs | Positive finite number; 15000. | Provider/network operation deadline. |
| clockSkewSeconds | Finite 0–300; 30. | Token validation allowance, not TTL extension. |
| now | Optional trusted clock callback; Date.now. | Deterministic host/test time. |

createZeroNativeAuth uses serverUrl instead of issuer, secureStorage instead
of vault, and callback instead of callbacks. Other options remain the same.
serverUrl is the canonical app origin or /auth issuer; HTTPS outside loopback,
no unrelated path/query/fragment/credentials. It derives origin/auth.

These adapter functions are trusted code. Runtime validation cannot prove that
a caller's “vault” truly uses secure OS storage or that a fake crypto adapter
uses strong randomness.

## Broker Client

createNativeAuthBrokerClient options:

| Option | Type/default | Effect |
| --- | --- | --- |
| transport | Required NativeAuthBrokerTransport. | Trusted request/subscription bridge. |
| serverUrl | Required canonical Zero origin or auth issuer. | Expected broker/client origin. |
| fetch | Optional NativeFetch; global fetch. | Consumer-side same-origin authenticated fetch. |
| requestTimeoutMs | Positive finite; 30000. | Ordinary broker request deadline. |
| authorizationTimeoutMs | Positive finite; 960000. | Longer interactive command deadline. |

The generic broker protocol includes access-token/callback operations.
Do not expose it as an untrusted token-free UI protocol.
[Broker and Sync](./broker-sync.md) explains selection and cleanup.

createNativeSyncAuth(auth) has no separate policy configuration; it derives
getToken, refreshAuth and bindAuthLifecycle from the owner. The surrounding
Sync client still supplies its own URL, tables, connection options and server
resource policy.

## Rust Builder

The independent private preview exposes NativeAuthConfig::builder(serverUrl,
clientId), then these methods:

| Builder method | Default / bounds | Effect |
| --- | --- | --- |
| redirect_uri | Required exact registered URI. | Loopback/private-use/claimed HTTPS; Rust rejects callback query/fragment/credentials/localhost. |
| scopes | Default identity scopes, openid always restored. | Typed IdentityScope values. |
| storage_namespace_prefix | Omitted => opaque issuer/client-bound namespace. | Unreserved ASCII prefix; final namespace bound 192 means prefix up to 128. |
| authorization_timeout | 15m; at least 1s and no greater than 1h. | System-browser operation bound. |
| network_timeout | 15s; positive, no greater than 5m. | Network bound. |
| clock_skew | 30s; no greater than 5m. | Token validation allowance. |

build returns Result<NativeAuthConfig,ConfigError>. Construction derives
canonical app/issuer/audience and validates before making the controller.
The required NativeAuthAdapters are http, secure_store, callback, browser,
entropy and clock; they are Arc-owned trusted traits.

Default reqwest-client feature exports ReqwestHttpClient; disabling it requires
a caller HttpClient. The workspace requires/pins Rust 1.88 in its preview
toolchain. No bundled OS vault/browser/mobile callback adapter is promised.

Tauri Builder receives an already-assembled NativeAuth.
Its default permission set is empty; individual generated command permissions
and window scope are host capability configuration, not an auth API key.

## Chrome Worker Options

Public preview import is `@zero/chrome-auth`; not yet a qualified registry
dependency/peer range.

| ChromeExtensionAuthOptions | Type/default | Effect |
| --- | --- | --- |
| serverUrl | Required Zero HTTPS origin or auth issuer; loopback HTTP development. | Canonical origin, no unrelated path/query/fragment/credentials. |
| clientId | Required public ID, 1–128 allowed ASCII. | Exact registered client. |
| callbackPath | Safe relative path, 1–128; zero-auth/callback. | Exact chrome.identity callback; no empty/dot/dotdot segments or leading slash. |
| persistence | session (default) or local. | Session worker-lifecycle storage versus opt-in profile persistence. |
| scopes | Optional identity scopes. | Framework always adds openid/defaults profile+email. |
| storageNamespace | Optional trimmed bounded namespace. | Framework issuer/client default when omitted; explicit migration boundary. |
| authorizationTimeoutMs | Positive finite; framework 900000. | Interactive flow bound. |
| networkTimeoutMs | Positive finite; framework 15000. | Network bound. |
| clockSkewSeconds | Finite 0–300; framework 30. | Validation allowance. |
| fetch | Optional trusted/test NativeFetch function. | Worker provider adapter. |
| crypto | Optional trusted/test randomBytes/SHA-256 adapter. | Proof entropy/crypto. |

Unknown keys, including clientSecret, reject. Worker construction validates
Chrome context, stable exact callback and non-split incognito ownership.
Session persistence targets the preview's Chrome 116 minimum; local requires
its Chrome 140 storage-access policy. Both use TRUSTED_CONTEXTS, not a
worker-only sealed vault.

## Secrets, Diagnostics And Qualification

Configuration contains publishable server/client metadata plus trusted adapter
objects, not provider/client secrets. Vault envelopes, refresh/verifier and
callback values are never diagnostics. Fixed safe error DTOs differ between
framework, Rust and Chrome; preserve their actual contract rather than assuming
all methods return the same result union.

The core framework and child previews have separate versions/commits/packaging
gates. These options were inspected against source; exact released artifacts
and host/browser certification must be verified separately before public
support is advertised.

## Related Guides And Next Steps

- [Framework client](./framework-client.md) describes async methods and cleanup.
- [Rust/Tauri](./rust-tauri.md) documents the deny-by-default UI boundary.
- [Chrome](./chrome.md) documents storage and message sender trust.
- [Roadmap](./roadmap.md) identifies remaining publication/adapters.
