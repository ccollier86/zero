---
id: zero.pdf.security
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: resource-and-script-policy
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, scoped-storage]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# PDF Resource And Script Policy

[PDF index](./index.md) · [Documentation index](../../index.md)

Default remote resources are denied, JavaScript disabled, data resources
allowed, blob resources denied and denied-resource behavior error.
The default renderer injects a CSP before head resources and intercepts browser
requests; resource policy is distinct from user/drive authorization.

## Resource Decisions

- deny rejects HTTP(S).
- same-origin requires a valid baseUrl and exact equal origin.
- allowlist requires an exact normalized origin in allowedOrigins.
- allow accepts HTTP(S), still subject to private-host blocking.
- file and other unsupported schemes are rejected; about:blank is the special
  admitted about resource. Data/blob follow their switches.

Denied error fails promptly with PDF_RESOURCE_DENIED; omit aborts the blocked
resource and allows printing without it. The latter is a deliberate output
policy, not proof that a blocked image was included successfully.

## Literal Host Classification

blockPrivateNetworks rejects localhost/.localhost/.local, selected private/
loopback/link-local/shared IPv4 literals and corresponding IPv4-mapped IPv6,
IPv6 unspecified/loopback/unique-local/link-local literals.
The development correction handles mapped private IPv4, the full link-local
prefix, and avoids treating an ordinary fcdn-prefixed DNS name as IPv6.
The prefix basis is the [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry).

The evaluator is pure URL/host policy and does **not** resolve DNS or pin
resolved addresses. This is not a general DNS-rebinding/network-egress
sandbox claim. Default deny is appropriate for untrusted content; remote
allow is an operator decision for trusted controlled inputs/assets, not a
public arbitrary-URL screenshot endpoint. Actual deployment egress controls
and trusted-origin ownership remain important.

## Content Boundary

Chromium contexts block service workers and downloads. CSP disables workers,
objects and form submission; script-src is none unless trusted JavaScript is
explicitly enabled. Supplied HTML is not comprehensively sanitized; custom
renderer adapters must implement their promised security policy independently.

Operational denied URLs remove credentials/query/hash, retaining useful
origin/path. Arbitrary secrets embedded in path segments are not universally
redacted. Never include source HTML, rendered PHI or credential-bearing URLs
in error/metadata channels.

## Verification And Related Guides

Pure resource/CSP tests use synthetic URLs without network. Real browser policy,
redirect/network behavior and tenant Storage acceptance need separate qualified
fixtures; no interactive-browser/security certification is inferred from source.

- [Configuration](./configuration.md) owns switches/defaults.
- [Browser runtime](./browser-runtime.md) owns process/isolation mechanics.
- [Storage](./storage.md) owns output authority.
