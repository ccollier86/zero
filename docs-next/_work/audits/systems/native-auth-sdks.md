---
id: zero.inventory.native-auth-sdks
type: inventory
audience: [maintainer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
applies_to: ["Zero 2.1.1 source baseline; child SDKs are independently versioned"]
modes: ["native desktop/mobile client", "Chrome Manifest V3 extension"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: committed-baseline-clean
  date: "2026-10-04"
  evidence_level: source-observed
related_packages:
  - package: "zero-native-auth / tauri-plugin-zero-auth"
    version: "0.0.0"
    maturity: preview
  - package: "@zero/chrome-auth"
    version: "0.0.0"
    maturity: preview
---

# Native Auth SDKs System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

This inventory covers the framework native OIDC server/client API and two
independently maintained SDK checkouts under ignored `sdk/` paths. Zero `main`
was `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspected framework `HEAD` is
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`, package metadata version 2.1.1.
Child repository commits were `3ad97adb366e3281c3621f83ed2c74ca690499b1`
(Rust/Tauri) and `622ef4e4eeb2577510417d0405286c7771765fe4` (Chrome). Their
statuses were clean at inspection. No child version establishes compatibility
with a Zero release.

## Purpose And Terminology

Native auth lets installed public clients authenticate against a deployed Zero
Guardian issuer. “Public client” means no embedded client secret. PKCE binds the
authorization response; refresh credentials remain in an SDK-owned secure
store, not the UI/webview. Chrome is a separate extension adapter with its own
worker, permissions, lifecycle, and storage tradeoffs.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Zero native OIDC server/provider | Source-observed; managed Zero server | `@zero/framework/auth`, `auth.nativeApps`, discovery/authorize/token/userinfo/revocation routes | `src/auth/oidc/native-*`, `src/auth/native/`, native auth integration/recovery/registration tests | [Guardian provider](../../../backend/guardian/native-provider.md) | Detailed draft |
| Framework TypeScript native client | Source-observed; Bun/browser-capable library API | `@zero/framework/native`: `createNativeAuthClient`, `createZeroNativeAuth`, broker, lifecycle, PKCE, secure-store and callback adapters | `src/native/index.ts`, `src/native/public-api.test.ts`, `src/native/*test.ts` | [Client](../../../backend/native-auth/framework-client.md), [broker/Sync](../../../backend/native-auth/broker-sync.md) | Detailed draft |
| Rust native engine + Tauri v2 plugin | Private 0.0.0 preview; installed desktop host; mobile adapters absent | independent crates `zero-native-auth`, `tauri-plugin-zero-auth` | child `Cargo.toml`, README, source/tests | [Rust/Tauri](../../../backend/native-auth/rust-tauri.md) | Detailed draft; no release claim |
| Chrome MV3 adapter | Private 0.0.0 preview; Chrome 116 session / Chrome 140 local mode per child README | independent `@zero/chrome-auth` | child `package.json`, README, docs and tests | [Chrome](../../../backend/native-auth/chrome.md) | Detailed draft; no release claim |

## Public Surface Map

Framework export is `@zero/framework/native`; server routes/configuration live
under `@zero/framework/auth`. Rust/Tauri and Chrome SDK repos are not framework
package contents, submodules, or create/update payloads. Parent `sdk/README.md`
documents the boundary and isolation. Rust exposes a platform-neutral engine and
narrow Tauri commands; OS vault/browser/callback adapters are host-supplied.
Chrome exposes a worker-owned facade and token-free message bridge. These APIs
and constraints are sourced from their own repos and must be documented with
their independent preview version, not inferred from framework 2.1.1.

## Integration Map

- Zero registers exact public client IDs and redirect URIs. Browser-based
  sign-in still leaves Guardian registration, verification, password, MFA, and
  consent policy on the server.
- Authorization Code + PKCE, issuer/audience/nonce/state/redirect validation,
  refresh rotation and tenant switching cross server/client boundaries. The
  framework TypeScript client exposes state/status, initialize/signIn/signUp,
  callback completion, refresh, tenant list/switch, user/token access,
  authenticated fetch, sign-out and state subscription; refresh secrets remain
  inside the client/vault abstraction.
- Rust requires host adapters for secure storage, browser, callback, bounded
  HTTP, entropy, and clock. Tauri ACL defaults deny commands; UI does not receive
  credentials or arbitrary authenticated-request capability.
- Chrome's single MV3 service worker owns auth and refresh. Storage persistence
  differs between session and local modes; privileged extension pages remain in
  Chrome `TRUSTED_CONTEXTS` and are not isolated from storage by the worker.
- Build, package, release, and compatibility policies are independent in each
  SDK repo; parent Zero tooling intentionally excludes the checkouts.

## Configuration Inventory

Server `auth.nativeApps` is optional; `enabled` defaults to whether `clients[]`
is nonempty. TTL defaults are request 15m, authorization code 3m, refresh 30d;
client scopes default to `openid profile email`. Each client requires unique
`clientId`, already-trimmed nonempty `name`, and one or more exact `redirectUris`;
allowed scopes are only `openid`, `profile`, and `email`, including required
`openid`. `requestAdmission` defaults to cleanup batch 100, outstanding caps
1000 global/100 per client/20 per source, a 1m rolling window, and admission
caps 300 global/60 per client/20 per source; trusted proxies default empty and
the header name defaults `x-forwarded-for`. It accepts a custom `sourceKey`,
mutually exclusive with proxy fields. `refreshRotation` defaults to cleanup
batch 100, minimum interval 30s, max 4096 rotations per family, and 10 active
families per user/client. `auth.nativeApps.issuer`
may be omitted and resolved from provider config. TTL upper bounds are 1h,
10m, and 365d respectively. No environment key is declared here.

Framework native client `NativeAuthClientOptions` requires `issuer`, `clientId`,
`vault`, `browser`, and `callbacks`; fetch defaults to global fetch and crypto
to WebCrypto. Scopes default to profile+email (openid is always added), storage
namespace defaults to issuer+client ID, and authorization/network timeout,
clock skew defaults are 900000ms/15000ms/30s. Issuer must be HTTPS or HTTP
loopback. Redirect/browser/vault/callback/crypto adapters remain host duties;
no credentials are embedded in the installed client. No environment binding.

Rust builder and Chrome `createChromeExtensionAuth()` options differ and are
defined in child repositories. Their exact repo contracts are not release
contracts: no published version/framework peer range exists, so no per-platform
minimum or compatibility guarantee is asserted.

## Evidence And Verification

Inspected framework exported declarations, resolver/provider source, relevant
integration/public API tests, and child README/manifests/source metadata; did not
build or execute either SDK. Child package labels are private 0.0.0.
Framework source observation does not establish published support or adapter
certification. Current docs under `docs/auth/native-app-auth.md` and
`docs/auth/app-auth-sdk-guide.md` are research, not the child release contract.

Framework source: [`src/native/index.ts`](../../../../src/native/index.ts),
[`src/auth/oidc/auth-native.plugin.ts`](../../../../src/auth/oidc/auth-native.plugin.ts).

## Findings

### Independent Source Review Supplement

Actual defaults were checked in native/config.ts and auth/native/config.ts/policy-config.ts rather than declaration comments alone. [Package exports](../catalogs/package-exports.md) and [hook coverage](../catalogs/frontend-hooks.md) reconcile framework native/browser-continuation surfaces. Child SDK previews remain independently versioned; no child runtime or artifact was qualified.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Do not present the local child repos as installable Zero dependencies or claim
  version compatibility from matching version numbers.
- Rust mobile/browser/vault adapters and Chrome production/security release
  gates remain explicit gaps in child readmes.
- The framework TypeScript native client is a distinct package surface from the
  Rust/Tauri and Chrome SDKs; reconcile the client support promise and maturity.
- This inventory is source-observed only; child test/build gates were not run.

## Known Future Plans

Child README release gates mention platform adapters/certification, compatible
framework peer range, browser security/lifecycle tests, ownership, licensing,
and publication. These are release prerequisites stated in the child repos, not
Zero platform roadmap commitments.

## Navigation And Cross-Link Plan

Parent: [systems](./index.md). The [native SDK index](../../../backend/native-auth/index.md)
now links seven focused draft pages: index, framework client, broker/Sync,
Rust/Tauri, Chrome, configuration and roadmap. The Guardian provider guide has
contextual reciprocal SDK links. The guide deliberately distinguishes the
generic trusted broker's access-token/callback operations from the narrower
token-free Rust/Tauri and Chrome UI contracts.

### Detailed Guide Source And Check Evidence

The companion rewrite re-read actual core public client/options/adapter/broker/
Sync/session/fetch source and the two child manifests, public barrels, config,
Rust command/DTO/HTTP traits and Chrome factory/message/storage/cleanup source.
The ignored child repositories remained clean at their inventoried commits;
no child source, package/build output, app or live state was changed.

The framework's public ergonomic/Sync check:
`bun --no-env-file test src/native/public-api.test.ts src/native/sync-auth.test.ts`
passed **9 tests, 0 failed, 33 assertions across 2 files**. It used synthetic
adapters, not a live provider or real OS vault.

`bun --no-env-file test docs-next/_work/checks/native-examples.test.ts`
passed **1 test, 0 failed, 2 assertions**, compiling five actual TypeScript
guide examples against the core native public export and separate child Chrome
source export with an in-memory TypeScript host. It did not execute adapter
code, contact a provider or perform a child build. Rust snippets are explicitly
dependent host fragments, source-reviewed but not compiled in this pass.

The structural checker passed the completed combined batch with
**227 pages / 227 unique IDs / 227 reachable / 0 problems**. These are source/
documentation checks, not child artifact or browser/platform certification.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.
- [x] Every inventoried native feature has a focused draft guide and config/index/roadmap.
- [x] OS adapter ownership, generic broker trust and Chrome privileged-context storage are documented from source.
- [x] Core ergonomic/Sync behavior and five actual TypeScript examples checked without live state.

- [ ] Cross-check exact framework public declarations and server wire behavior.
- [ ] Record package versions/commits and compatibility only from releases.
- [ ] Reconcile OS-specific adapter and Chrome permission/storage contracts.
- [ ] Whole-platform independent review completed.
