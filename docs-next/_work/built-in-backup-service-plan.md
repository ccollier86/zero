---
id: zero.work.built-in-backup-service
type: roadmap
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
implementation_state: planned
visibility: internal
system: platform-runtime
feature: backups
maturity: planned
---

# Built-in backup service — follow-on requirement

[Working evidence](./index.md) · [Runtime](../backend/runtime/index.md) ·
[Current foundation work](./durable-jobs-and-workers-plan.md)

User direction, 2026-11-15: backups belong in Zero itself, configurable through
destination adapters, not an application-specific plugin. This records future
work only. **Do not divert from the active worker/cron/service-integration
upgrade, enable backups, or imply a backup API already exists.** Detailed design,
implementation and restore qualification will follow separately.

## Ownership and integration requirements

- Zero should own scheduling, consistent capture, private manifests,
  encryption/key references, verification, retention, status and restore tools.
  Adapters choose where packages go, including a native local destination;
  an external service must not be required to operate the feature.
- Inventory existing SQLite, migration, Fabric, Storage and logging recovery
  mechanisms first. Reuse the shared job/worker foundation rather than creating
  another timer, queue or process supervisor.
- Cover the admitted SYSTEM, application and feature/tenant Fabric databases
  and referenced Storage objects. Preserve identities, grants, migration
  history, audit provenance and pending-work/receipt identities. Define exactly
  which configuration and deployment artifacts a complete recovery needs.
- Capture live SQLite/WAL and supported HOT durability correctly. Several
  database files are not automatically one atomic snapshot: define a consistent
  recovery boundary and cross-file/object reconciliation before claiming one.
- Perform bulk capture/compression/encryption/upload in supervised background
  workers with bounded memory, disk and I/O. Keep interactive reads/writes,
  authentication and reactive delivery responsive; do not hold application SQL
  or Guardian authority leases across network upload or worker admission waits.
- Admit configured destinations and narrowly scoped credentials in trusted
  configuration. Do not let a browser choose arbitrary paths, network targets,
  modules or secrets. Apply Guardian authorization to backup, inspection,
  download, deletion and restore operations.
- Distinguish captured, uploaded, verified, failed and uncertain packages.
  Only complete verified recovery sets count as usable backups. Retention and
  holds must not remove the only verified recovery set or its required objects.
- Keep recovery-key availability/rotation explicit and separate from encrypted
  packages. Provide isolated restore rehearsals with identity, digest, version,
  object-reference and authorization checks before any deliberate cutover.
- Restoring old state must not blindly replay already-sent email, payments or
  other external effects, or silently restore obsolete access. Specify receipt
  reconciliation and revocation handling as part of the restore contract.

Destination durability, independent custody and encrypted backup integrity are
different properties. A same-machine copy is useful recovery material, but not
protection from losing that machine or independent proof against its full
administrator compromise. Importable historical log packages are a related,
separate future archival feature; they do not replace full recovery backups.

No production action, new destination, credentials, retention cutoff or API name
is approved or activated by this note.
