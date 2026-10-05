---
id: zero.pdf.storage
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: rendered-object-acceptance
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

# Render And Store A PDF

[PDF index](./index.md) · [Documentation index](../../index.md)

renderToStorage(input,target) first renders, then writes through the selected
writer and returns the render result plus canonical FileInfo.
A render result alone is not durable storage. A write failure does not require
deleting an existing app object as an automatic compensation.

## Target And Authority

PdfStorageTarget requires driveId/path; optional overwrite/public default false,
metadata and createdBy. The normal request facade excludes createdBy and seals
the actual creator to the current actor. Its writer delegates to scoped Storage
objects.upload, including fresh authority after asynchronous rendering.

Caller-supplied driveId/path chooses an existing authorized destination, not a
physical folder/tenant selector. Setting public:true does not grant permission
to expose an object; Storage rules still govern. Role revocation during render
must stop an unauthorized subsequent storage write.

An already accepted scoped Storage write is not reclassified as uncommitted
if authority changes immediately afterwards. This distinction prevents unsafe
duplicate retries. The retained canonical object result remains the receipt.

## Writer Ownership

ZeroPdfStorageWriter turns path basename into the file name, fixes content type
through PDF bytes and includes zeroPdfRenderer metadata. Missing Storage fails
PDF_STORAGE_UNAVAILABLE. Default managed-created PdfService resolves only its
own runtime's Storage service lazily, not an ambient sibling app getter.
Standalone default writer uses the unambiguous compatibility getter.

Privileged raw setup service accepts an explicit writer/createdBy; that is
trusted server composition, not a public permission bypass. A custom writer
must provide its own destination/authority/durability contract.
Normal request zero.pdf does not allow replacing its writer or closing the
shared renderer.

## Verification And Related Guides

Test authorized drive, denied target, revocation while renderer waits, accepted
write followed by revocation, overwrite/public policy and two app-local writers.
Synthetic tests cover orchestration; no live file or PHI is required.

- [Storage authority](../storage/request-authority.md) owns live request fences;
  [permissions](../storage/permissions.md) owns destination/object ACL rules.
- [Rendering](./rendering.md) owns bytes/limits.
- [Runtime services](../runtime/server-services.md) separates raw/scoped capabilities.
