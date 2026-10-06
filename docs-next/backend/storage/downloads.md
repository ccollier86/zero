---
id: zero.storage.downloads
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: downloads
maturity: supported
applies_to: ["2.2.1 development source with HTTP path correction; not package-qualified"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "b4a47cab24839a4b2033c093df315d14cc47b627"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authenticated Downloads And Byte Ranges

[Storage index](./index.md) · [Documentation index](../../index.md)

Managed downloads resolve drive/object scope, ACL, lifecycle and current
authority before returning metadata/bytes. The local blob checksum/path is never
a substitute for that access check.

## Streaming

Full download returns a stream with logical FileInfo or a not-found result.
The range path validates the requested byte interval and returns proper partial
content behavior; unsupported/unsatisfiable ranges receive the safe
STORAGE_RANGE_NOT_SATISFIABLE classification (416), not an arbitrary file read.

HTTP downloads support Range and ETag/conditional handling.
Official SDK methods accept logical paths, not pre-encoded URLs. The HTTP
wildcard boundary decodes each encoded segment exactly once before lookup and
ACL evaluation; spaces/Unicode and literal `%20`/`%2F` filename text remain
distinct. See [logical paths and HTTP encoding](./objects.md#logical-paths-and-http-encoding).
Do not assume every adapter's readBlobRange is a full fetch disguised as a
range: adapter support and streamed errors need deployment qualification.

## Disposition And Content

Detected inline-safe content can be served inline; executable/unsafe content
uses attachment disposition. Uploaded extension/request MIME alone is not a
reason to inline HTML/SVG or another executable format.
Names are safely encoded for response headers rather than concatenated from
raw request text.

A UI preview should use the official authenticated/signed download mechanism,
not build a public URL to the byte directory.

## Live Fences And Lifecycle

Awaited storage lookup/stream admission rechecks the captured authority and
managed generation. Suspension/deletion/organization switch cannot silently
reuse a previously admitted current-drive capability.

Already-transmitted bytes cannot be retracted by later revocation; do not describe
revocation as undoing data a client has already received.

See [capabilities](./capabilities.md), [permissions](./permissions.md),
[request authority](./request-authority.md), [Studio lifecycle](./studio-lifecycle.md)
and [errors](./errors.md).
