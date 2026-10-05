---
id: zero.data-studio.schemas
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: schemas
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

# Logical Schema Language And Evolution

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Data Studio uses a closed version1 JSON schema document, not executable
Schema.field callbacks or arbitrary SQL declarations.

## Example

```ts
import type { DataStudioSchema } from '@zero/framework/data-studio';
export const schema: DataStudioSchema = {
  version: 1,
  columns: [
    { columnId: 'title_col', key: 'title', label: 'Title', type: 'text', required: true },
    { columnId: 'done_col', key: 'done', label: 'Done', type: 'boolean', required: false, defaultValue: false },
  ],
};
```

ColumnId is the stable cell identity; key is the machine name used by admitted
filters; label is display text. Array order controls presentation.
Types are text/number/boolean/date/datetime/json. Every column includes required;
description/defaultValue are optional and defaults validate against its type.

## Admission

Version must be1. IDs are bounded safe alphanumeric/underscore/hyphen,
case-insensitively unique. Keys are lowercase letter-led underscore/digit names,
unique and not reserved prototype keys.
Unknown schema/column fields, duplicate IDs/keys, sparse arrays and invalid
defaults fail. Hard column/schema byte limits apply.

## Existing Rows

Removing/retyping a column with stored values is rejected.
Optional→required needs every existing row to have a nonnull value.
New required columns on a nonempty table are rejected, even with a future-create
default: defaults are not retroactive row backfills.

IDs once reserved cannot be recycled into a different new column.
For a deliberate transition, add an optional column, populate through acknowledged
row replacement, then require it when actual data satisfies the rule.
No automatic destructive cast/backfill is inferred.

Archived tables cannot change schema. Changes create immutable history and
increment schemaRevision. See [history](./schema-history.md),
[values](./values.md), [rows](./rows.md) and [limits](./limits.md).
