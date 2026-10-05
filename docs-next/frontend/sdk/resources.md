---
id: zero.frontend.sdk.resources
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: resources
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, authenticated, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Policy-Aware HTTP Resource Clients

[SDK index](./index.md) · [Documentation index](../../index.md)

`client.resource<RowType>(name, options?)` calls generated resource CRUD routes
through the normal authenticated JSON transport. Use it for server-side query,
policy-aware HTTP mutations and resource idempotency. A resource name is the
registered resource, not permission to access any raw table.

## Prerequisites And Example

The server must declare/admit the resource, enable its generated routes and grant
the current actor the appropriate read/write/tenant policy. The default prefix
is /api/resources; a facade prefix override can align a deliberately configured
server route prefix. It does not create routes or change authority.

```ts
import type { InferRow } from '@zero/framework/schema';
import { tasks } from './db/schema';

type Task = InferRow<typeof tasks>;
// Fragment: client is the normal configured app Client; tasks resource exists.
const resource = client.resource<Task>('tasks');
const result = await resource.list({ limit: 20, offset: 0 });
const row = await resource.get('synthetic-task');
```

The facade does not put rows into the reactive collection automatically. Choose
the relevant demand-loaded hook/control when that composition is wanted; keep a
server page's accepted order/membership separate from shared cached records.

## Methods And Results

| Method | Request / result |
| --- | --- |
| name | readonly resource name |
| list({ filters?, sort?, limit?, offset?, signal? }?) | GET server query; returns `{ rows, page }` with server page metadata |
| get(id, { signal? }?) | GET one row; resolves the row, not its HTTP `{ row }` wrapper |
| create(input, options?) | POST partial row; resolves accepted row |
| update(id, input, options?) | PATCH partial row; resolves accepted row |
| delete(id, options?) | DELETE; resolves `{ deleted, id }` |
| remove(id, options?) | delete alias with the same result/options |

Names and IDs are route encoded. Filters/sort use the normal Zero data-query
contract, not caller-built SQL. The server owns field exposure, permitted query
operations, exact/unknown totals and policy evaluation. A caller generic does
not validate an arbitrary response or force fields excluded by server projection.

Mutation options are signal and idempotencyKey. All methods are awaited HTTP
operations; there is no separate optimistic collection receipt attached to a
resource response. Distinguish these from [Collection Async methods](./acknowledged-mutations.md).

## Uncertain Results And Idempotency

Every generated mutation sends an Idempotency-Key, generated when omitted.
ResourceMutationError preserves the exact key that was sent, even if the original
response was lost. It also retains cause and available HTTP status/body for
structured handling. The public class is available from @zero/framework/react.

```ts
import { ResourceMutationError } from '@zero/framework/react';

try {
  await resource.update('synthetic-task', { done: true });
} catch (error) {
  if (error instanceof ResourceMutationError) {
    // Retain error.idempotencyKey with this exact logical update.
    // Reconcile/retry under the server's policy; do not invent a new key
    // and automatically repeat an uncertain operation.
  } else {
    throw error;
  }
}
```

Reuse a key only for the same logical operation, request and relevant authority
context. A changed body/target is a different operation; a key is not an access
token or an override for server conflict/deduplication rules. Header-safe explicit
key constraints are in [configuration](./configuration.md#resource-options).

Aborting an HTTP wait does not prove the request never committed. Do not blindly
repeat it using a new generated identity or treat notification failures after an
accepted response as an unsuccessful database write.

## Authority, Scope And Errors

All transport uses the main client, including restoration/refresh and scope
fences. The backend resolves current tenant/application authority; passing a
resource name or prefix cannot select another organization's database. Normal
server [service boundaries](../../backend/runtime/server-services.md) and data
planes remain authoritative.

Mutation errors may carry raw HTTP bodies/causes. Present safe bounded UI feedback
and record the standard error context without logging credentials or private
record payloads. Query/configuration/permission failures are not a reason to
disable policy or import unscoped framework services into browser code.

## Verification And Compatibility

Test filters/sort/offset metadata, encoded names/IDs, get/create/update unwrapping,
delete result and explicit/generated idempotency keys using synthetic transport.
Then qualify permission boundaries and uncertain-result retries against a scoped
server fixture. A unit mocked HTTP success does not establish cross-tenant
isolation or a broader installed-package support range.

The facade retains its ordinary API and default prefix. Backend schema/mode
migration is separate from changing a client prefix or collection/resource view.

## Related Guides And Next Steps

- [HTTP](./http.md) owns underlying request/error behavior.
- [Configuration](./configuration.md#resource-options) lists exact options.
- [Collections](./collections.md) owns local reactive state and load/clear.
- [Schema validation](../../backend/schema/validation.md) separates logical and authority checks.
