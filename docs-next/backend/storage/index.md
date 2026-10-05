---
id: zero.storage.overview
type: index
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: overview
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

# Storage And Storage Studio

[Backend index](../index.md) · [Documentation index](../../index.md)

Storage combines durable bytes, system-database metadata, hierarchical access
and signed capabilities. Storage Studio adds optional owner-aware drive
provisioning and lifecycle controls; it is not a second byte adapter.

## Core Storage

- [Composition](./composition.md): managed app versus standalone plugin ownership.
- [Configuration](./configuration.md): every app/Studio setting and injection boundary.
- [Adapters](./adapters.md): local bytes and required deletion/shutdown contracts.
- [Drives](./drives.md): quotas, visible catalogs and logical ownership.
- [Objects](./objects.md): files/folders, path validation and tracked mutations.
- [Downloads](./downloads.md): range, conditional requests and safe disposition.
- [Blob lifecycle](./blob-lifecycle.md): CAS publication, references and recovery.
- [Permissions](./permissions.md): user/role/trusted-property ACLs.
- [Public access](./public-access.md): public read is not public modification.
- [Capabilities](./capabilities.md): signed bounded downloads/uploads.
- [Upload grants](./upload-grants.md): exact-path public upload without public drives.
- [Request authority](./request-authority.md): live Guardian fences.

## Managed Drive Control Plane

- [Studio installation](./studio-installation.md): optional owner modes/capabilities.
- [Studio permissions](./studio-permissions.md): explicit app role fragments.
- [Provisioning](./studio-provisioning.md): owner/key/receipt and first ACL setup.
- [Editing](./studio-editing.md): revisions, immutable identity and conflict UX.
- [Quotas](./studio-quotas.md): count/byte limits and concurrent reservations.
- [Lifecycle](./studio-lifecycle.md): suspension, deletion, retry and recovery.
- [External providers](./studio-providers.md): idempotent lifecycle hooks.
- [Studio authority](./studio-authority.md): app/org/personal administration boundaries.
- [Client integration](./client-integration.md): official authenticated SDK and reactive UI.
- [Errors](./errors.md): codes, outcomes and safe observability.
- [Roadmap](./roadmap.md): future adapters/stronger isolation, not current promises.

## Data Ownership And Principles

Canonical metadata/ACL/Studio sidecars live in the
[system plane](../runtime/data-planes.md), not each Fabric app file.
The built-in bytes use shared content-addressed blobs. A logical drive is an
authorization/quota namespace, **not** a separate disk/folder with physical
per-organization isolation.

The inspected code favors explicit live authority, fenced publication/deletion,
bounded lifecycle jobs and honest accepted/unknown outcomes.
Use [Guardian](../guardian/index.md) permissions and the scoped service;
do not expose raw storage-engine methods as a browser-selectable admin API.
