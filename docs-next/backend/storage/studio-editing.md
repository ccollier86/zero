---
id: zero.storage.studio-editing
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-editing
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

# Edit Drive Settings With Revisions

[Storage index](./index.md) · [Documentation index](../../index.md)

Studio update requests require operationId and expectedRevision.
Name, maxSize/maxFileSize, allowedMimeTypes and public are editable; owner/key/
drive identity are not relocated by changing display metadata.

## Typed Request

```ts
import type { StorageStudioDriveUpdateRequest } from '@zero/framework/storage';
export const update: StorageStudioDriveUpdateRequest = {
  operationId: 'edit-example-1',
  expectedRevision: 3,
  name: 'Automation files',
};
```

The revision must come from the currently admitted drive profile, not a
hardcoded real app constant. This example only illustrates the wire shape.

## Conflict And Acceptance

A stale revision returns STORAGE_REVISION_CONFLICT rather than silently
overwriting another user's settings. After conflict, refresh/review actual state;
a new logical edit uses its own operation ID and current revision.

Same-ID same-intent retry can use the stored receipt.
Unknown write outcome needs the same key, not a new duplicate operation.
Quotas/public/MIME ceilings and live authority are rechecked at the managed
commit boundary.

## UI Contract

An edit remains pending until server acceptance. Disable duplicate submits and
keep failed input available for review. After acceptance, refreshing another
panel or a notification callback failing is not a reason to replay the write.

The server controls the permitted fields/capabilities; hiding a field is not
permission enforcement. Clear pending edit/selection/results when switching
organization or losing authority.

See [provisioning](./studio-provisioning.md),
[quotas](./studio-quotas.md), [lifecycle](./studio-lifecycle.md),
[client integration](./client-integration.md) and [errors](./errors.md).
