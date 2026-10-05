---
id: zero.native-auth.roadmap
type: roadmap
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: sdk-release-and-platform-qualification
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

# Native SDK Roadmap And Release Gates

[Native SDK index](./index.md) · [Documentation index](../../index.md)

The core native protocol/client exists. Independent Rust/Tauri and Chrome
adapters are private previews. Open work below is not a claim that native auth
must be rebuilt or that every optional host integration is already included.

## Existing Source Contracts

- Framework public TypeScript client, ergonomic serverUrl entry, OIDC/PKCE,
  secure-vault/browser/callback seams and same-origin authenticated fetch.
- Single-owner generic broker/proxy, revisioned state and Sync lifecycle bridge.
- Rust engine with strict validation, secure-store traits, bounded HTTP, tenant
  replacement and deny-by-default Tauri command adapter.
- Chrome MV3 worker facade, exact callback, storage binding, serialized lifecycle
  and token-free trusted-page messages.
- Guardian browser/account/MFA/tenant policy remains the server authority.

## Explicit Preview Release Gates

- [ ] Choose owner, license and real repository metadata for each child package.
- [ ] Publish a real compatible framework peer contract/range for Chrome; never
  ship the runtime-throwing test fixture as its dependency.
- [ ] Qualify staged artifacts and independent versioning/upgrade behavior.
- [ ] Certify real browser/callback/vault/single-instance/cold-launch/package
  behavior for each advertised Rust OS/platform.
- [ ] Certify Chrome service-worker suspension/restart, browser restart,
  storage-mode changes, privileged UI security, exact stable callback and
  revocation against a compatible provider.
- [ ] State a supported core/child/host matrix based on qualification, not
  coincidental version numbers or source test pass counts.

## Host And Ergonomics Work

- [ ] Bundled/audited OS vault adapters for macOS, Windows and Linux.
- [ ] Mobile browser/keystore/deep-link adapters for iOS/Android.
- [ ] A narrow Tauri guest package and ordered token-free state channel, if
  designed around the existing Rust command owner.
- [ ] Additional browser-extension adapters only after their identity/storage/
  worker trust models are evaluated; no Firefox/Safari/MV2 promise is inferred.
- [ ] Host scaffolds making adapter ownership and deny-by-default capabilities
  simple without hiding credential storage or unsafe IPC.

## Conditions For Any Expansion

Reuse existing Guardian user/session/membership/RBAC policy. Keep exact
callbacks and issuer/proof validation, one refresh owner, safe error/DTO
projection, lifecycle cancellation, current tenant boundaries and focused
recovery/revocation tests. Do not solve a host adapter gap by putting a client
secret or raw refresh token into the UI.

Future host support requires its own docs/examples/qualification. The framework
provider and an SDK's adapter should remain separate layers so adding a platform
does not require a new canonical account system.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists real options.
- [Rust/Tauri](./rust-tauri.md) identifies required host adapters.
- [Chrome](./chrome.md) describes storage/security release responsibilities.
- [Guardian roadmap](../guardian/roadmap.md) separates upstream identity-provider expansion.
