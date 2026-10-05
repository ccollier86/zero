---
id: zero.storage.studio-quotas
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-quotas
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

# Quotas And Concurrent Upload Reservations

[Storage index](./index.md) · [Documentation index](../../index.md)

Studio bounds drive counts, file/drive sizes, object counts and aggregate
in-flight upload bytes. A client-side size hint is not the authority boundary.

## Meaning Of Zero

Count limits for organization/personal drives are positive (defaults100/10).
Object/byte limits default0, meaning no configured ceiling—not “reject every
byte” or “zero drives allowed.”
Default drive/file sizes must fit configured maxima; file limits must fit the
corresponding drive limit where bounded.

## Reservations

Concurrent uploads reserve admitted declared bytes under the system boundary.
Blob/Uint8Array sizes are inferred; streams supply contentLength where required.
Actual streamed bytes, MIME and final commit policy remain checked.

Reservations are committed/released/expired with owned lifecycle.
Two concurrent writes cannot each assume the same unused quota balance outside
the transaction. A failed upload must not leave a successful object or an
unbounded permanent reservation.

maxConcurrentUploadBytes is per drive. It is not whole-process RSS or a global
provider-bandwidth quota.
MIME allowlists use detected content; request content-type/name alone is not
proof.

## Setting Changes

Lowering quotas requires current revision/authority and valid relationships.
Existing usage doesn't disappear when a setting changes; check safe failure and
actual current state before showing a successful edit.

Quota failures map to explicit STORAGE_QUOTA_EXCEEDED/limit errors with
accepted/unknown outcome semantics preserved.
See [configuration](./configuration.md), [objects](./objects.md),
[blob lifecycle](./blob-lifecycle.md), [editing](./studio-editing.md)
and [errors](./errors.md).
