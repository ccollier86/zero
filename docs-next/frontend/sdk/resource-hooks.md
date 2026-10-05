---
id: zero.frontend.sdk.resource-hooks
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: resource-hooks
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Policy-Aware Resource Hooks

[SDK index](./index.md) · [Documentation index](../../index.md)

Generated resource hooks use the integrated authenticated client; they do not
perform policy evaluation in the browser or write directly to collection stores.
Import useResourceClient/useResourceList/useResourceRecord/useResourceActions
from @zero/framework/react.

```tsx
const list = useResourceList<Task>('tasks', { pageSize: 20 });
const record = useResourceRecord<Task>('tasks', selectedId);
const actions = useResourceActions<Task>('tasks');
```

This fragment assumes the imported hooks, app Task type, selectedId and an exposed
resource named tasks. A table declaration alone does not create that route.

useResourceClient(resource,{ prefix? }) returns the resource facade or null before
admission/hydration. Captured facade operations check the current scope before
and after asynchronous work; an old-scope result is not reusable authority.

## Lists

UseResourceListOptions is filters/sort/pageSize/initialPage/autoLoad/prefix.
Defaults empty filters, no sort,50rows/page, page1, auto-load=true, normal SDK prefix.
The result contains rows/page/pageSize/filters/sort/loading/error/pageInfo/hasMore,
refresh and page/filter/sort setters corresponding to useDataPage.
Manual refresh is supported with autoLoad=false.
Rows are an owned HTTP list result, not all cached table records. These hooks do
not themselves establish a realtime collection subscription.

## Records And Actions

useResourceRecord(resource,id|null,{ autoLoad?, prefix? }) returns row/exists/
loading/error/refresh plus update(partial,mutationOptions) and remove(options).
Without an ID there is no record; operations return null rather than fabricate it.
Writes return accepted promised row/delete result through the resource facade.

useResourceActions(resource,{ prefix? }) returns loading/error/resetError and
create(input,options), update(id,input,options), remove(id,options).
ResourceMutationOptions includes signal/idempotencyKey. Reuse the key with the
same logical input after ambiguous outcomes; do not blindly retry fresh writes.
These methods are not the optimistic collection void API.

Scope/unmount/request ordering protects displayed results. Cancellation of a
wait is not proof that an accepted server effect was rolled back. Backend
permission/field/tenant/idempotency policy stays authoritative.

## Verification

Test auto/manual load, missing ID, partial filters/sort, rejected or unknown writes,
same-identity live revocation, scope/unmount and delayed old responses.
Keep custom error presentation safe; hooks are not universal payload redactors.

## Related Guides And Next Steps

- [Resources](./resources.md) owns generated HTTP/error contracts.
- [Data composition](./data-composition.md) owns table-query counterparts.
- [Mutations](./mutations-and-connection.md) wraps app-specific commands.
- [Guardian](../../backend/guardian/authorization.md) owns policy semantics.
