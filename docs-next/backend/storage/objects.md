---
id: zero.storage.objects
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: objects
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

# Files, Folders And Metadata

[Storage index](./index.md) · [Documentation index](../../index.md)

Objects have stable IDs and canonical logical paths within a drive.
Folders form the hierarchy; bytes are separately content-addressed.
The engine rejects ambiguous/path-traversal/reserved invalid input rather than
mapping caller text directly to a filesystem path.

## Operations

Trusted objects API supports upload/download/downloadRange/get/list,
createFolder/move/copy/delete, setVisibility and updateMetadata.
Tracked metadata mutations feed the system data-plane stream; they are not raw
writes in each organization's Fabric database.

Upload accepts a ReadableStream<Uint8Array>, Uint8Array or Blob.
Options are overwrite (false), metadata, public, contentLength, maxSize and
allowedMimeTypes. Streaming callers provide declared size for reservation
admission; actual bytes and detected MIME still govern final limits.

## Listing

ListOptions supports file/folder/all, literal case-insensitive substring search,
cursor, limit, sortBy (name/size/created_at/updated_at) and sortDir.
Default limit100 and name ascending apply to immediate children, not a recursive
full-drive search. ListResult reports items/cursor/total.

Do not confuse its explicit total with Studio catalog's has-more page contract,
or assume a frontend cache contains every matching object.

## Mutations And Metadata

Overwrite is explicit. Move/copy/delete preserve valid paths/parent relationships
and blob-reference invariants through tracked transactions.
Metadata replacement is bounded serialized app metadata, not a permission
grant or an instruction to run code.

Folder/subtree operations and concurrent path mutations have their own ownership;
a browser must not directly edit storage_objects to rename a file.

See [blob lifecycle](./blob-lifecycle.md), [downloads](./downloads.md),
[quotas](./studio-quotas.md), [request authority](./request-authority.md) and
[client integration](./client-integration.md).
