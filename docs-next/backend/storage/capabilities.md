---
id: zero.storage.capabilities
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: capabilities
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Signed File Capabilities

[Storage index](./index.md) · [Documentation index](../../index.md)

Storage uses server-owned HMAC signing for bounded file capabilities.
Explicit signingSecret wins, then ZERO_STORAGE_SIGNING_SECRET; otherwise managed
startup retains a random key in the system database.

The secret is never a browser key. Persisted system identity/key ownership is
part of deployment/restart planning.

## Presigned Access

CreatePresignedOptions selects driveId/path, upload or download, expiresIn,
secret and optional maxSize/contentType/managed generation.
Public helper createPresignedToken produces a signed token; verifyPresignedToken
checks signature/expiry and returns its decoded capability or null.

These cryptographic helpers do not perform current ACL/Studio lifecycle admission
by themselves. Normal issuance/consumption routes perform that policy and capture
the relevant managed drive generation.

Default TTL is3600 seconds; Studio maxCapabilityTTL caps issuance.
A signature is not a promise that a suspended/deleted drive remains accessible
until the wall clock expires.

## Consume Safely

The /storage/presigned route uses method-specific bounded access.
Treat the token URL as a secret, avoid raw logging and never concatenate an
untrusted path into filesystem access.

When a workflow needs an upload answer tied to a particular resource, prefer the
structured [upload grant](./upload-grants.md) flow with app-owned correlation
rather than a globally writable folder.

## Revocation And Rotation

Live lifecycle/generation admission can invalidate old managed capabilities.
Changing signing material invalidates tokens signed by the old secret; there is
no automatic dual-secret rotation catalog in this helper contract.
Plan rollout/storage identity explicitly.

See [public access](./public-access.md), [downloads](./downloads.md),
[Studio lifecycle](./studio-lifecycle.md) and [errors](./errors.md).
