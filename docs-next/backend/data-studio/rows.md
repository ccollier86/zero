---
id: zero.data-studio.rows
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: rows
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Create, Replace And Delete Logical Records

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Rows have rowId/tableId, complete values, schemaRevision, optimistic revision
and timestamps. A logical row is not a raw physical record that clients may
patch without the command boundary.

## Browser Example

```ts
import type { Client } from '@zero/framework';
export function addRecord(client: Client, tableId: string, operationId: string) {
  return client.dataStudio.createRow(tableId, {
    title_col: 'An example',
    done_col: false,
  }, { operationId });
}
```

This assumes those exact column IDs are in the current logical schema.
Use the hydrated schema to assemble values, not a guessed key↔ID mapping.

## Full Replacement

replaceRow takes tableId, rowId, expectedRevision, complete values and mutation
options. It is not a partial cell patch; retain unchanged values deliberately.
Defaults/missing/required semantics follow the current schema codec.

deleteRow requires the expected revision and a stable operation ID.
Create/delete updates row count, private cells and column stats in the same
tracked transaction. Read-only/public reconciliation cannot perform these writes.

## Revisions And Ownership

Rows are attributed to current canonical user/membership and remain inside the
organization's physical DB. Schema revision describes the validation basis;
row revision protects concurrent replacement/delete.

Archived tables deny mutations. Row count/quota and input budgets are server
admission, not just editor constraints.
A stale editor must refresh/review the current row rather than overwrite with an
old full value map.

See [values](./values.md), [concurrency](./concurrency.md),
[ownership](./ownership.md), [queries](./queries.md) and
[frontend integration](./frontend-integration.md).
