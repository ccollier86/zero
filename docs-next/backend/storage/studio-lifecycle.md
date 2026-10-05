---
id: zero.storage.studio-lifecycle
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-lifecycle
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

# Suspend, Delete, Restore And Retry

[Storage index](./index.md) · [Documentation index](../../index.md)

Managed drives have explicit provisioning/ready/degraded/suspended/deleting/
deleted/restoring/failed states. Lifecycle commands require operationId,
expectedRevision and one of suspend/resume/delete/restore/retry.

## Authority And Generation

Manage and delete are different permissions. Personal-owner policy remains
scoped; owning a drive does not grant platform administration.
Transitions increment revision and, where needed, generation so old capabilities
cannot silently access a changed managed drive.

Suspension blocks the appropriate current access/ingress boundary without
pretending the file bytes vanished. Resume is not an inverse database migration.

## Durable Work

Delete commits deleting state then uses bounded cleanup jobs and actual blob
reference release. Cleanup can be retrying/failed; a committed lifecycle change
with failed continuation is not a not-started write.

Jobs have queued/running/succeeded/failed/cancelled state, generation, attempts,
availability and safe failure code. Expired leases/restart recovery are fenced;
maintenance begins after complete composition and is joined during shutdown.

Retry resumes the relevant failed cleanup/provision continuation.
Do not create a new operation ID to replay an unknown intent.

## Restore Is Not File Backup Recovery

Restore re-admits the deleted logical drive/provider namespace through the
configured lifecycle provider. The built-in shared-CAS provider has no external
restore work; it does **not** recreate object records or bytes already purged by
completed deletion.
Recovering deleted content requires a separate actual backup/restore strategy.
Do not advertise a successful logical restore as undeleting all files.

See [providers](./studio-providers.md), [blob lifecycle](./blob-lifecycle.md),
[errors](./errors.md), [editing](./studio-editing.md) and
[client integration](./client-integration.md).
