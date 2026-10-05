---
id: zero.storage.drives
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: drives
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

# Drives, Catalogs And Usage

[Storage index](./index.md) · [Documentation index](../../index.md)

A drive is a logical file hierarchy, quota root and ACL root.
Engine records have stable drive ID, nullable single-mode tenant binding,
owner ID, name, max_size_bytes/max_file_size_bytes, MIME policy, visibility
and creation time.

## Engine Surface

Trusted StorageService.drives provides create/get/update/list/listForUser,
delete/usage/setVisibility. Raw list/get are trusted engine operations;
normal clients use the permission-checked HTTP/scoped service boundary.

CreateDriveParams contains name, maxSize/maxFileSize (bytes; zero unlimited),
allowedMimeTypes (default all, supports MIME wildcards), and public.
Current multi mode rejects unscoped creation/listing rather than guessing a
tenant from a user-supplied name.

## Managed Provisioning

Storage Studio supplies owner-bound stable machine keys, permission-checked
provisioning, configuration ceilings, revisions and guarded lifecycle.
Do not replace it with an app endpoint calling raw drives.create with arbitrary
ownerId from the browser.

Usage reports totalBytes/maxBytes, file/folder counts and percentUsed.
A configured unlimited quota is not zero available capacity or a zero-size
filesystem. Object/byte ceilings and current reservations are explained in
[Studio quotas](./studio-quotas.md).

## Visibility And Deletion

Visibility grants public read only; management remains gated.
Legacy direct drive deletion is a bounded atomic engine operation, not an
unbounded cleanup job. Managed Studio deletion follows explicit lifecycle/jobs
and remains safe under interruptions.

See [permissions](./permissions.md),
[Studio provisioning](./studio-provisioning.md),
[Studio lifecycle](./studio-lifecycle.md) and
[client integration](./client-integration.md).
