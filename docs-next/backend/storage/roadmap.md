---
id: zero.storage.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: roadmap
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

# Storage Roadmap

[Storage index](./index.md) · [Documentation index](../../index.md)

## Known Directions

- [ ] Investigate stronger physical organization/drive isolation and additional
  byte adapters with demonstrable publication/deletion/recovery contracts.
- [ ] Continue reusable file-browser/preview/control-plane polish on the existing
  adaptive permission/read-model foundation.
- [ ] Investigate organization-owned vector stores and chunk metadata as a
  separate feature, not a current storage adapter setting.
- [ ] Reuse independent log/error/audit operational planes where useful without
  treating file storage as a database placement system.

These are user/product directions, not current isolation values or future dates.
shared-cas is the only admitted Studio isolation contract now; Fabric SQL file
isolation does not physically split CAS bytes automatically.

## Current Foundation

Authenticated storage, hierarchical ACL, signed capabilities, upload grants,
blob publication recovery, quota reservations and Studio lifecycle/control
already exist. Do not introduce an unrelated manager UI because the foundation
was overlooked.

Content restore and logical drive restore are distinct. Deploy actual backups/
restore procedures when deleted file recovery is required.

See [adapters](./adapters.md), [lifecycle](./studio-lifecycle.md),
[configuration](./configuration.md) and [Studio installation](./studio-installation.md).
