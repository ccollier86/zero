---
id: zero.frontend.storage.sdk-integration
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: sdk-integration
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Storage Studio SDK Integration

[Storage UI index](./index.md) · [Documentation index](../../index.md)

The normal browser Client exposes `client.storageStudio`, bound to the same authenticated client.fetch transport and Guardian scope fences. Use this facade for owner-aware managed-drive operations; core storage hooks cover file bytes/ACLs.

## Public Methods

| Method | Contract |
| --- | --- |
| getCapabilities(options?) | Browser-safe policy and current capabilities. |
| listDrives(request?, options?) | Owner/lifecycle/search/cursor/limit; one drive page. |
| getDrive(driveId, options?) | One scoped logical profile. |
| getDriveByKey(key, owner?, options?) | Stable key under current organization/personal scope. |
| listDriveJobs(driveId, request?, options?) | Bounded cursor/limit job history. |
| provisionDrive(request, mutationOptions?) | Owner/key/name/limits/MIME/public/creatorAccess; receipt. |
| updateDrive(driveId, request, mutationOptions?) | Required expectedRevision plus mutable fields; receipt. |
| changeDriveLifecycle(driveId, request, mutationOptions?) | Required expectedRevision and action; receipt. |

Read options accept signal. Mutation options accept signal plus optional operationId. Request bodies omit operationId because the facade generates/inserts it. Responses contain operationId/replayed/value; logical profiles do not disclose provider paths/signing material.

```ts
import type { Client } from '@zero/framework/react';

export async function ResolveWorkflowDrive(client: Client) {
  const drive = await client.storageStudio.getDriveByKey('workflow-files', 'organization');
  return drive.drive.drive_id;
}
```

Server workflows/functions should use the authority-scoped **server** storage contract instead of inventing a browser session. See [request authority](../../backend/storage/request-authority.md).

## Public Facade Helpers

The framework/react facade also exports `createStorageStudioSdkSurface(fetch)`, `STORAGE_STUDIO_API_PREFIX` (`'/storage/studio'`), `createStorageStudioOperationId()`, `StorageStudioMutationError` and `isStorageStudioMutationError(value)`. The factory accepts the SDK-compatible authenticated generic fetch function; it is not a credential resolver or tenant selector. Prefer the integrated client.storageStudio for normal apps. A separately composed surface must be scope-bound/cleared by its owner.

Operation IDs use native crypto where available. The error guard narrows to the actual error instance; it is not a parser for arbitrary wire JSON. Request/mutation option types and StorageStudioSdkSurface are exported through the same client facade. The component/controller barrel does not export these transport helpers merely because it exports Studio UI.

## Ambiguous Mutations

A mutation can commit while its response is lost, unparsable, or rejected by a later scope change. StorageStudioMutationError retains operationId, status/code/retryable/outcome/requiresSameIdempotencyKey. Retry an unknown outcome with the same operationId and same semantic input in the original legitimate scope; generating a new ID can create a distinct operation.

Expected revisions detect stale edits. Conflicts should refresh/reconcile, not silently overwrite. A mutation receipt's replayed flag distinguishes replay from a new logical admission, not “all provider jobs finished.” Deletion/restore may return lifecycle work that continues server-side.

setScope/clear are result-acceptance partition controls, not authority setters. The native hook binds them correctly; custom integration must invalidate old results on auth transitions and cancel obsolete reads. Never pass a user-selected tenant ID to simulate another scope.

[Family index](./index.md) · [Native hook](./use-storage-studio-management.md) · [SDK scoped services](../sdk/scoped-control-planes.md) · [Backend provisioning](../../backend/storage/studio-provisioning.md) · [Errors](../../backend/storage/errors.md)
