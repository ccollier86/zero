---
id: zero.storage.adapters
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: adapters
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

# Byte Adapters And Physical Isolation

[Storage index](./index.md) · [Documentation index](../../index.md)

The adapter owns bytes by SHA-256 content identity; the storage engine owns
logical object metadata and reference counts. LocalStorageAdapter uses Bun
file/stream operations under the admitted private storage root.

## Adapter Contract

StorageAdapter supplies writeBlob, readBlob, readBlobRange, blobExists/blobSize
and optional stop. A write returns checksum, size, MIME-detection head bytes and
an optional opaque durable publication receipt.

The accepted deletion/shutdown contract additionally requires:
- removeBlobSync for the non-yielding fenced physical deletion boundary;
- writeShutdownSafety cooperative, or durable-publication with bounded
  listPendingBlobPublications and settleBlobPublication hooks.

The legacy asynchronous removeBlob method remains typed for compatibility, but
the shared-CAS engine does not invoke it for automatic deletion. An arbitrary
awaited delete cannot preserve a renewed reference/lease boundary safely.

## Studio Admission

Enabled Studio requires the configured isolation mode in
supportedStudioIsolation; currently the only public mode is shared-cas.
Claiming support is an adapter implementation obligation, not a promise that
the framework converts an S3-style API into synchronous local deletion.

Adapter I/O receives AbortSignal where applicable. Publication journals and
settlement hooks must remain usable during bounded shutdown handoff.
Native/external adapter compatibility requires its own deployment tests.

## What Shared CAS Means

Equal bytes can share one blob even across logical drives. Drive ACLs/owner scope
control metadata/object access; a checksum or filesystem name is not an access
token. Do not publicly serve the byte root or expose blob keys in a new endpoint.

Physical per-drive folder/disk isolation is not implemented by the shared-cas
label. See [roadmap](./roadmap.md), [blob lifecycle](./blob-lifecycle.md),
[permissions](./permissions.md) and [configuration](./configuration.md).
