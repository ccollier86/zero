---
id: zero.frontend.data-studio.values
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: values
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

# Logical Values, Stable Keys And Examples

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Data Studio uses immutable columnId for stored row value maps and public column
key for API input maps. These are not interchangeable, nor are they raw SQL
identifiers. Values are logical string/number/boolean/null/JSON structures.

The Studio component subpath exports formatDataStudioValue(value,column),
dataStudioValueDraft(value,column), parseDataStudioValueDraft(draft,column) and
dataStudioCodeExample(table). Formatting presents typed values; drafting produces
editor text; parsing validates finite numbers, booleans, dates/datetimes and JSON.
Optional blank numeric/date/JSON fields can become null; required/type errors
produce field-specific feedback. Inspect column defaults separately from an
explicit stored null; a display placeholder is not a persisted default.

## Schema Defaults And Editing

The visual schema editor distinguishes no default (the `defaultValue` property
is absent), explicit null and a custom typed value. Zero never substitutes truthy
checks that would drop valid zero or false defaults. Required fields reject null.
JSON defaults use the existing multiline Textarea; boolean defaults use Select;
date/datetime drafts use native date controls (datetimes retain millisecond
precision with step 0.001). Numeric defaults use a text input with decimal input
mode so unfinished/incompatible text remains visible rather than being silently
cleared by a native number control. Final admission still requires a finite number.

Renaming a persisted display label never changes its public field key automatically.
An explicit field-key edit keeps the stable column ID but changes what API callers
must send; header edits require acknowledgement, and whole-schema saves review
the change before persistence. Reordering is presentation only. Column deletion
or replacement does not automatically migrate existing data.

The [Visual/JSON dialog](./dialogs.md) shares these defaults and IDs across both
authoring modes. [JsonEditor](../components/json-editor.md) only manages a local
document; the service codec and optimistic revision enforce accepted writes.

Root/React exports dataStudioCellValue(row,columnId), preserving absent as
undefined versus stored null, and dataStudioRowValuesByKey(row,columns), projecting
only existing values into public-key input maps. dataStudioRowQueryKey(tableId,
query={}) creates stable identity from limit/offset/search/filter/sort fields;
it performs no request or permission check.

```ts
import { dataStudioRowValuesByKey } from '@zero/framework/react';

const values = dataStudioRowValuesByKey(row, table.schema.columns);
```

This fragment assumes an admitted current row/table. Do not reuse the projection
with another organization's schema or omit revision checking for writes.

dataStudioCodeExample produces browser/API orientation text, not raw SQL.
The generated interface/snippet may require additional app imports/context,
especially DataStudioValue for JSON fields; do not treat it as an executed/
fully typechecked complete project. Render code as text, not eval.

## Related Guides And Next Steps

- [Inline cells](./inline-cell.md) consumes typed drafts.
- [Dialogs](./dialogs.md) authors logical values and defaults.
- [SDK](./sdk.md) owns query/mutation transport.
- [Inspector](./inspector.md) presents generated code.
