---
id: zero.schema.types
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: inference
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Logical And Stored Type Inference

[Schema index](./index.md) · [Documentation index](../../index.md)

Use inference aliases to distinguish values accepted by a logical validator,
its parsed output and the row shape a collection stores. A type is not runtime
validation, permission or database readiness. Prefer deriving types over copying
the same fields into a separate interface.

## Choose The Right Alias

All of these aliases are public from `@zero/framework/schema`:

| Alias | Input | Meaning |
| --- | --- | --- |
| `InferSchemaInput<typeof descriptor>` | SchemaDescriptor | logical values before validation/defaults; optional inputs may be omitted |
| `InferSchemaType<typeof descriptor>` | SchemaDescriptor | Valibot-parsed logical output; defaults may fill an omitted input |
| `InferRow<typeof table>` | defineTable result | collection row representation, including the configured primary key |
| `InferInsert<typeof table>` | defineTable result | inferred row shape with only its generated primary key made optional |
| `InsertInput<Row, PrimaryKey?>` | existing row type | row insertion boundary with the chosen/default inferred key optional |
| `PrimaryKeyOf<Row>` | inferred or ordinary record type | hidden inferred key metadata, otherwise literal id when present, otherwise never |

The schema subpath is the least ambiguous import for all aliases. Browser/server
barrels expose selected subsets; do not assume every alias is re-exported by every
facade. [Registry augmentation](./registry.md) is a separate, explicit type map.

## Input Versus Parsed Output

```ts
import {
  defineSchema, field,
  type InferSchemaInput, type InferSchemaType,
} from '@zero/framework/schema';

const taskForm = defineSchema({
  title: field.text({ required: true }),
  done: field.boolean(),
  email: field.email(),
});

type TaskInput = InferSchemaInput<typeof taskForm>;
// { title: string; done?: boolean; email?: string | null }
type TaskOutput = InferSchemaType<typeof taskForm>;
// { title: string; done: boolean; email: string | null }

const input: TaskInput = { title: 'Review a task' };
const parsed = taskForm.validate(input);
if (parsed.success) {
  const output: TaskOutput = parsed.output;
  // done is false; email is the optional blank default.
}
```

The output is concrete because these defaults fill omission. An optional Guardian
reference does not invent an ID; an optional constrained number whose implicit
zero is invalid can remain undefined. Their output properties can therefore
remain optional. Null remains an explicit valid absent optional scalar/reference.

Required boolean/defaultValue=false remains a required boolean input. Likewise,
an explicit default on a required string does not make that property optional.

## Stored Rows And Insert Inputs

```ts
import {
  defineTable, field,
  type InferRow, type InferInsert, type PrimaryKeyOf,
} from '@zero/framework/schema';

const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  done: field.boolean(),
  labels: field.tags(),
  estimate: field.number({ min: 1 }),
}, { pk: 'task_id' });

type TaskRow = InferRow<typeof tasks>;
type TaskInsert = InferInsert<typeof tasks>;
type TaskKey = PrimaryKeyOf<TaskRow>; // 'task_id'

const row: TaskRow = {
  task_id: 'synthetic-task', title: 'Review a task', done: false,
  labels: '[]', estimate: null,
};
const insert: TaskInsert = {
  title: 'Review a task', done: false, labels: '[]', estimate: null,
};
```

The collection row representation deliberately differs from logical form values:
tags/multiple choices/dateRange/JSON use text storage, while declared boolean
columns are exposed as booleans by the client. Optional physical scalar and TEXT
fields can contain null. Use [codecs](./codecs.md), not a cast, when moving logical
arrays/objects to the wire shape.

`InferInsert` makes only the primary key optional. It does not turn every
required=false schema field into an optional stored-row property or apply defaults
itself. Runtime insert/key generation and logical validator defaults remain their
own operations. For a hand-written row without an id or inferred key, InsertInput
does not silently guess which other field is its primary key.

## Literal Choices And Dynamic Options

```ts
const priority = field.enum(['low', 'high'], { required: true });
const reviewers = field.combobox([
  { label: 'Operations', value: 'operations' },
  { label: 'Support', value: 'support' },
], { multiple: true });
```

Logical priority output is `'low' | 'high'`; reviewers output is an array of
the two declared values. Optional single choices additionally include blank/null.
Literal required=true and multiple=true narrow the shape; a boolean supplied at
runtime retains the conservative union of valid possibilities. Do not cast a
dynamic multiple flag to true just to obtain an array type.

`schema({ ... })` preserves each definition's field validators and literal custom
primary key in `definitions`. Use its descriptor with InferSchemaInput/Type;
the `_types` member retains original configuration, not a ready-made row map.

## Verification And Compatibility

The focused inference fixture statically compiles public schema imports and
positive/negative assertions without executing application declarations. It
checks logical defaults, nullable scalar/reference values, literal/dynamic options,
schema().definitions, stored encodings, primary keys and public registry aliases.
It is source evidence, not a promise that arbitrary app declarations have been
typechecked or that an installed artifact has been qualified.

The audited correction replaces previously erased logical types. Compile errors
may reveal invalid values that untyped validators previously allowed through the
type system; optional stored scalar reads may require null handling. Fix the value
or choose the correct logical/stored alias instead of hiding the mismatch with any.

## Related Guides And Next Steps

- [Fields](./fields.md) specifies each validator and absence/default behavior.
- [Registry](./registry.md) defines explicit global table-name/row aliases.
- [Codecs](./codecs.md) covers logical/wire conversion.
- [Tables](./tables.md) owns generated primary keys and composition.
- [Validation](./validation.md) explains why types never replace server admission.
