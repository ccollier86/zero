---
id: zero.frontend.data-studio.sdk
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: sdk
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio SDK And Retained Retry Identity

[Data Studio index](./index.md) · [Documentation index](../../index.md)

client.dataStudio is the normal organization-bound surface. Reads include
getCapabilities/listTables/getTable/listRows/listSchemaVersions.
Writes include createTable/updateTable/setTableStatus/createRow/replaceRow/
deleteRow. The React controller's updateCell projects current row values and
uses revisioned replacement; it is not a separate SDK method. Cache/reconciliation methods are integration facilities;
do not use setScope to manufacture authority. Server Guardian binding remains
independent of the browser cache partition.

DATA_STUDIO_API_PREFIX is '/api/_zero/data-studio'. createDataStudioSdkSurface
is an advanced browser-safe constructor taking the fetch function and optional
reconciliation source. Prefer the integrated client so auth and live fences
are reused, not a custom unauthenticated fetch.

DataStudioRowQuery includes limit/offset/search/filters/sortColumnId/sortDirection.
Accepted DataStudioRowPage includes rows/total/limit/offset/nextOffset.
Follow nextOffset, not offset+pageSize: byte budgets can return short pages.
Filter shape uses immutable columnKey/operator/value and documented scalar bounds.
Read options accept signal. Mutation options add optional operationId.

## Mutation Errors

[Backend concurrency](../../backend/data-studio/concurrency.md) owns receipt replay,
revision conflict and unknown-outcome behavior; [HTTP API](../../backend/data-studio/http-api.md)
owns endpoint admission. Client operation tracking does not broaden either.

createDataStudioOperationId() creates an opaque operation identity, not a credential.
DataStudioMutationError carries operationId, status, code, retryable and
requiresSameIdempotencyKey plus optional cause. isDataStudioMutationError and
isDataStudioRevisionConflict classify it; revision conflict code is
DATA_STUDIO_REVISION_CONFLICT. Do not blindly retry a stale record revision.

```ts
import { isDataStudioMutationError } from '@zero/framework/react';

try {
  await client.dataStudio.createRow(tableId, values, { operationId });
} catch (error) {
  if (isDataStudioMutationError(error) && error.requiresSameIdempotencyKey) {
    retainForRetry(error.operationId);
  }
  throw error;
}
```

This fragment assumes actual client/tableId/values/operationId and app-owned
retention. Reuse the same identity with the same logical input after an ambiguous
outcome; a fresh ID may duplicate an already accepted operation. Do not log raw
values, headers, tokens or error causes.

DataStudioOperationTracker is public from /react/hooks. begin(key) allocates/reuses
an identity; succeed(key,optionalId) retires it; fail(key,error,optionalId) retains
unknown-outcome identity in generation order; clear() removes local tracking.
It is process-local bookkeeping, not durable storage or a distributed lock.
The connected controller owns one tracker per authorization scope.

Cache rows/catalog/results clear on authorization boundaries. Sync signals are
read-only invalidations and do not enable arbitrary Studio writes over Sync.
A canceled wait does not prove a server write was canceled.

## Related Guides And Next Steps

- [Controller](./controller.md) integrates transport and retry identity.
- [Values](./values.md) owns public-key projection/query identity.
- [Inline cells](./inline-cell.md) handles stale revisions in the UI.
- [HTTP SDK](../sdk/http.md) owns authenticated request transport.
