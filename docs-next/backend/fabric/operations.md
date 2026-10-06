---
id: zero.fabric.operations
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: operations
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Use The Bound Async Database Client

[Fabric index](./index.md) · [Documentation index](../../index.md)

Normal tenant-bound server requests use `zero.data`. Its
`AsyncDatabaseClient` shape is exported as a type from
`@zero/framework/server`; app code does not construct it from a browser-supplied
tenant ID. It accepts no physical path, raw SQL or arbitrary callback.

The following function assumes its caller supplies the already-bound request
capability and separately enforces the relevant app/resource permission:

```ts
import type { AsyncDatabaseClient } from '@zero/framework/server';

export async function listNotes(data: AsyncDatabaseClient) {
  const page = await data.list('notes', { limit: 20 });
  return { rows: page.value.rows, nextCursor: page.value.nextCursor };
}
```

## Reads

`get(table, id, options?)` returns a row or null.
`list(table, {limit, after?}, options?)` pages by primary key ascending, with an
exclusive cursor and `nextCursor`; maximum limit is 500.
`find(table, input, options?)` provides schema-validated projection, typed
filter groups, deterministic order and bounded offset pagination.
`query(name, input, options?)` invokes a registered synchronous read handler.

Read results are `{ value, sequence: { seq } }`. Find returns an ordered row
array, not an exact total or automatic UI-page metadata. Its maximum limit is
1001, offset 1000000, order fields 8 and projected fields 128.
All columns/filter operators are admitted; raw SQL is not accepted as input.

### Array Membership Filters

Since 2.4.1, `find` and `list` accept a field predicate with
`operator: 'arrayOverlaps'` and a readonly string-array `value`. A stored JSON
string array must share at least one exact string with that value. Empty values
match nothing; malformed or mixed-type retained arrays deny the whole row.
The scalar filter operators remain unchanged. `list` adds optional `filters`
without changing its cursor/ordering/response contract; filters precede the limit.
Both reader and writer actors validate the same bounded payload.
See [complete array-policy examples and limits](../resources/array-overlap.md).

## Writes

`mutate(mutation, options)`, `batch({assertions?, mutations}, options)` and
`command(name, input, options)` require `idempotencyKey`.
Mutation variants are strict create, primary-key upsert, update and delete.
Upsert has ReactiveDB replacement semantics, not an implicit partial patch.
Batch evaluates assertions and mutations atomically in declared order; maximum
batch items is 256.

```ts
import type { AsyncDatabaseClient } from '@zero/framework/server';

export function renameNote(data: AsyncDatabaseClient, id: string, title: string, key: string) {
  return data.mutate(
    { type: 'update', table: 'notes', id, patch: { title } },
    { idempotencyKey: key },
  );
}
```

Commits return value, sequence, key and `replayed`. Retain the same key/input for
recovery of the same logical write; see [idempotency](./idempotency.md).

## Payload And Lifetime

Operation values are canonical JSON-like data: finite numbers, strings,
booleans, null, arrays and plain objects. Undefined, Date, bigint, typed arrays,
custom prototypes, sparse/cyclic values and functions are rejected.
Bounded nesting/size prevents unbounded IPC or durable receipt allocation.

Options include signal, queue timeout and operation timeout. The signal only
cancels work before dispatch. Authority is checked around read execution and
at the managed write commit boundary; passing the capability does not imply
every domain permission or field policy is automatically enforced.
Use declared [resources](../configuration/data-access.md) for those rules.
