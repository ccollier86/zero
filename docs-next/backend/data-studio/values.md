---
id: zero.data-studio.values
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: values
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

# Canonical Cells, Null And Defaults

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Row values are keyed by **columnId**, not display label or column key.
Each stored cell has canonical JSON and one typed scalar projection used by
server queries.

## Example

```ts
import { normalizeDataStudioRowValues } from '@zero/framework/data-studio';
import type { DataStudioSchema } from '@zero/framework/data-studio';

const schema: DataStudioSchema = {
  version: 1,
  columns: [{ columnId: 'title_col', key: 'title', label: 'Title', type: 'text', required: true }],
};
export const values = normalizeDataStudioRowValues(schema, { title_col: 'An example' });
```

The pure codec validates/detaches data; it does not authenticate or persist it.

## Types

Number means finite JSON number; boolean means actual boolean; text means string.
Date is a real YYYY-MM-DD calendar date.
Datetime accepts the admitted ISO timestamp shape and canonicalizes to UTC;
the corrected codec rejects impossible calendar dates instead of allowing
Date.parse to silently normalize February30/April31.

JSON accepts bounded strict JSON values, not Date/bigint/undefined/functions/
custom prototypes/cycles/sparse arrays/executable getters.

## Absence, Null, Required

A missing cell is distinct from a stored null.
Required means a present nonnull admitted value; it is not automatically a
nonblank text/content business rule.

Create/replacement materializes a declared default for an omitted field.
Reading physically stored values does not invent later schema defaults for old
rows. Unknown column IDs are rejected.
Null is allowed only for optional columns and remains a real typed null cell.

Byte/depth/node/collection/aggregate-row budgets apply independently.
See [schemas](./schemas.md), [rows](./rows.md),
[queries](./queries.md), [limits](./limits.md) and [errors](./errors.md).
