---
id: zero.platform-tokens
type: index
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: overview
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Platform Action And Resume Tokens

[Backend index](../index.md) · [Documentation index](../../index.md)

Platform tokens are opaque purpose/flow credentials for application actions.
They are **not** Guardian access JWTs, refresh tokens, API keys or native-client
authorization codes. Their raw secret is returned only at creation/rotation;
the SQL store retains a SHA-256 hash and safe identifying metadata.

- [Action tokens](./action-tokens.md): consume-once actions and exact purpose/scope checks.
- [Resume tokens](./resume-tokens.md): reusable resource credentials, touching and rotation.
- [Configuration](./configuration.md): defaults, standalone composition and system ownership.
- [Security and integration](./integration.md): transaction domain, app authorization and secret handling.
- [Roadmap](./roadmap.md): future direction, not fabricated token features.

The public server package is `@zero/framework/tokens`.
PlatformTokenService/Store and createPlatformTokenPlugin are real exports;
there is **no createPlatformTokenService factory** in this source.
Managed composition creates the service in the system database before Guardian
consumers. Privileged setup `zero.tokens` is generic; `zero.auth.tokens`
is Guardian's session token service.

Normal requests do not receive this raw secret-issuing service simply by being
logged in. Use an explicit application-authorized action boundary or the owning
Guardian/Torrent operation. This draft includes unreleased exact-expiry and safe
lifetime corrections, not an installed-package qualification.
