---
id: zero.resources.array-overlap
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: array-overlap-authorization
maturity: supported
applies_to: ["2.4.1 and later"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.1"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Authorize Rows By Exact String-Array Overlap

[Resources index](./index.md) · [Documentation index](../../index.md)

Use `arrayOverlaps` when an authorized subject may access a record belonging to
**any** of its allowed groups. It is a mandatory resource constraint, not a text
search or a browser-side filter. Existing scalar `eq` constraints remain valid.

```ts
import type { ResourceDataConstraint } from '@zero/framework/resources';

export const groupConstraint = {
  type: 'field',
  field: '_access_groups_json',
  operator: 'arrayOverlaps',
  value: ['group_support', 'group_operations'],
} satisfies ResourceDataConstraint;
```

## Declare A Resource

This example assumes the application maintains globally unique group IDs in a
server-trusted Guardian property. Declare `allowed_groups_json` as a string
property with `editableBy: 'system'` and `useInPolicies: true`; never accept an
allowed-group list from request parameters or a user-editable profile field.
For organization-specific grants, derive the list from the **current verified
organization and membership**, not a caller-selected organization ID.

```ts
import { defineTable, field } from '@zero/framework/schema';
import {
  customPolicy, defineResource, tenantRealm,
} from '@zero/framework/resources';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  _access_groups_json: field.json(),
}, { pk: 'id', sync: 'full' });

const groupReadPolicy = customPolicy(({ user }) => {
  if (!user) return false;
  const groups: unknown = JSON.parse(user.properties.allowed_groups_json ?? '[]');
  if (!Array.isArray(groups) || !groups.every(value => typeof value === 'string')) {
    return false;
  }
  return {
    allowed: true,
    constraints: [{
      type: 'field',
      field: '_access_groups_json',
      operator: 'arrayOverlaps',
      value: groups as string[],
    }],
  };
}, { name: 'task-group-read' });

export const tasksResource = defineResource({
  table: tasks,
  exposure: 'all',
  realm: tenantRealm(),
  actions: ['list', 'get'],
  fields: {
    read: ['id', 'title'],
    filter: ['title'],
    sort: ['id', 'title'],
  },
  policy: groupReadPolicy,
});
```

Register `tasks.serverTable` and `tasksResource` in the app's tables/resources;
in Fabric tenant-database mode, register the table in the corresponding realm
as well. Shared-row isolation additionally requires the tenant discriminator
declared by `tenantRealm()`. Physical database isolation does not require that
extra application column. See [realm configuration](./realms.md).

The projection stays hidden from clients while authorization uses the complete
server row. Read permission does not grant write permission. For a writable
resource, configure its write policies and allowed input fields separately;
server-maintained group labels must not be client-writable. Returned constraints
also guard loaded `get`, `update` and `delete` rows and mutation-receipt replay.
Creation still requires a deliberate create/stamping policy, not a grant inferred
from the visibility of an existing row.

## Exact Matching And Invalid Data

At least one complete stored string must equal a permitted string. Comparison
is case-sensitive, independent of a column's `NOCASE` collation; there is no
substring matching, wildcard expansion or scalar coercion. `g1` is different
from `g10`, `A` from `a`, and `"1"` from `1` or `true`.

The stored field can be a JSON array serialized into SQLite TEXT or a decoded
array in non-SQL evaluation. The two paths share the same bounded contract.
When writing through generated Resource CRUD's scalar HTTP row contract,
serialize the JSON field (for example `JSON.stringify(['A', 'B'])`); accepting
decoded arrays for predicate evaluation does not change that write-body contract.
Duplicates do not duplicate rows or page counts. An empty permitted list matches
nothing. Empty stored arrays, missing fields, nulls, malformed JSON, non-arrays,
nested arrays and arrays containing non-string elements deny the **whole row**,
even if another element would otherwise match. Invalid retained data does not
turn a read into an unrestricted query.

No sentinel is reserved by Zero. An application may use the empty string as an
ordinary exact group value, but `[]` does not mean “all groups” or “ungrouped”.
Invalid policy definitions fail closed with a safe configuration error; policy
values and row contents are not copied into framework failure telemetry.

### Bounds

| Boundary | Maximum |
| --- | --- |
| Permitted strings in one predicate | 50 |
| Strings in a retained row array | 256 |
| UTF-8 bytes in one string | 1,024 |
| UTF-8 bytes in a retained JSON representation | 65,536 |

Decoded arrays use their canonical `JSON.stringify` representation for the last
limit; raw JSON strings must also fit the limit before parsing. Strings must be
well-formed Unicode: unpaired surrogate escapes are denied, including when a
different element would match. Quotes, backslashes, embedded NUL and valid
Unicode remain literal exact values. String normalization/case folding is not
performed.

Policy arrays must be dense plain data arrays, without accessors, proxies,
extra properties or non-string values. Invalid policy input is a configuration
error; invalid retained rows are simply invisible. Constraint trees also share
Fabric's maximum 64 filter nodes, depth 8 and 256 SQL parameters, including the
query's limit/offset or cursor reservation. Combining predicates with client
controls can exhaust those budgets and must be handled as an error, not by
removing the policy. Do not use this bounded scan predicate as a claim of indexed
relational membership lookup for unbounded group catalogs.

## Compose Without Replacing Tenant Policy

Top-level constraints are ANDed. Inside a resource constraint, `allOf`/`anyOf`
use their `constraints` member. Inside a Fabric filter, those groups instead use
their `filters` member. For example, both the member and the row must satisfy
the group policy **and** the independent owner restriction:

```ts
import type { ResourceDataConstraint } from '@zero/framework/resources';

export const constrained = {
  type: 'allOf',
  constraints: [
    { type: 'field', field: 'owner_id', operator: 'eq', value: 'user_123' },
    {
      type: 'anyOf',
      constraints: [
        { type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['group_support'] },
        { type: 'field', field: 'published', operator: 'eq', value: true },
      ],
    },
  ],
} satisfies ResourceDataConstraint;
```

Neither a client filter nor an OR inside one policy can erase a separate tenant
realm, exposure rule, credential ceiling or mandatory policy. Authorization is
applied before search result limiting and paging. Response `page.count` remains
the number of returned authorized rows, **not** an invented exact table total.

## Use The Bound Fabric Client

The same predicate is available to `AsyncDatabaseClient.find` and filtered
cursor `list`. These functions assume an already-bound, permission-checked
request capability; direct database filters express a query and do not themselves
install resource policy on an arbitrary app endpoint.

```ts
import type { AsyncDatabaseClient, DatabaseFindFilter } from '@zero/framework/server';

export async function findTasks(data: AsyncDatabaseClient, allowedGroups: readonly string[]) {
  const filter = {
    type: 'field', field: '_access_groups_json',
    operator: 'arrayOverlaps', value: allowedGroups,
  } satisfies DatabaseFindFilter;
  return data.find('tasks', {
    filters: [filter], order: [{ field: 'title', direction: 'asc' }], limit: 20,
  });
}

export async function listTasks(data: AsyncDatabaseClient, after?: string) {
  return data.list('tasks', {
    limit: 20, after,
    filters: [{ type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['group_support'] }],
  });
}
```

`list` retains primary-key cursor ordering, bounded pages and `nextCursor`;
filters are applied before the limit. Reader/writer actors admit the same typed
predicate across IPC. All column names pass catalog validation, all values are
bound parameters, and malformed JSON is guarded before SQLite JSON traversal.

## Live Updates And Scope Changes

Full snapshots, lazy HTTP queries, catch-up and live Sync use the same resource
constraint. A tracked change from `["A", "B"]` to `["B"]` removes the row from
an A-only subscriber and retains it for B; changing back makes it visible again.
Reconnect must use current authority, not resurrect an old visible set.

Changes to the subject's trusted group properties change the policy/authority
fingerprint. The existing live authorization boundary invalidates stale rows;
membership detachment, revocation and organization changes remain independent
denial boundaries. A lazy view may need to load its new authorized query after
scope invalidation; it must not retain unauthorized cached rows.

The application owns label maintenance: update a parent and all dependent
projections in one tracked Fabric command/transaction. Raw SQL that bypasses
tracked ReactiveDB mutation is not a supported way to publish live changes.
See [resource Sync](./sync-integration.md) and [Fabric realtime](../fabric/realtime.md).

## Related Guides

- [Policy composition](./policy-composition.md) describes AND/OR grants.
- [Queries](./queries.md) covers admitted client search and paging controls.
- [Field access](./field-access.md) separates hidden policy labels from client data.
- [Fabric operations](../fabric/operations.md) documents bound actor operations.
- [Guardian user properties](../guardian/user-properties.md) explains trusted authority.
- [Realtime policies](../sync/policies.md) covers scope refresh and row delivery.
