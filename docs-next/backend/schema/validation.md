---
id: zero.schema.validation
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: validation
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

# Logical Validation And Server Mutations

[Schema index](./index.md) · [Documentation index](../../index.md)

Schema answers whether a logical value fits its declaration. Guardian/resource
policy answers whether this actor may perform the operation. Codecs answer how
the value is represented in SQLite/transport. A correct write needs the relevant
boundaries together; passing a browser validator never substitutes for server
authorization or validation.

## Validate A Logical Record

```ts
import { defineSchema, field } from '@zero/framework/schema';

const settings = defineSchema({
  contact_email: field.email(),
  quantity: field.number({ required: true, min: 1, integer: true }),
  labels: field.tags(),
});

const result = settings.validate({ quantity: 2, labels: ['review'] });
if (result.success) {
  const encoded = settings.encodeRow(result.output);
  // Logical labels became JSON text; this does not write or authorize anything.
} else {
  // result.issues provides field-addressed Valibot validation feedback.
}
```

`validate(data)` is synchronous and returns a Valibot safe-parse result. Use
result.output after success when defaults/transforms matter. A failure is not an
exception merely because a user's input is invalid. Declaration/default failures
can instead throw [SchemaConfigurationError](./fields.md#default-admission-and-errors).

The descriptor's object schema contains explicitly declared fields, not an
implicitly generated primary key. Valibot object validation returns that logical
shape; do not use it as a universal unknown-field rejection or field-access
policy. The server mutation boundary separately checks allowed mutation fields.

## What A Table Carries To The Server

[defineTable](./tables.md) returns `mutationValidator` and attaches the same
logical validation metadata to `serverTable`. `schema().serverTables` retains
the metadata too. Its symbol-backed storage prevents it from becoming a SQL
column or serialized browser policy.

Managed server composition collects these validators. Schema-backed Sync writes
and Fabric actor mutation execution use them; a raw SQL table without such a
validator does not suddenly gain the logical field rules. Passing only a JSON
copy of serverTable discards executable metadata and is not a supported way to
install the declaration.

The generated validator provides primaryKey, fieldNames, decodeRow, encodeRow
and validateRow. It describes row validation, not a capability to execute writes
or access another tenant. Application code normally supplies the table definition
to managed composition instead of calling internal mutation executors.

## Insert And Update Sequence

At the ordinary tracked mutation boundary:

1. The server admits the route/socket and live authority, resolves the resource
   decision and stamps/checks server-owned scope/ownership fields.
2. Required identity projections/data-plane readiness complete. Any authority
   that crossed an awaited policy/preparation lookup is revalidated before write.
3. The logical validator checks the actual table primary key and the mutation's
   allowed fields. A schema-backed insert validates the complete logical record.
4. An update loads the existing authorized row, merges the partial values and
   validates the complete logical record. A changed primary key is rejected.
5. The accepted logical result is encoded. For an update, only fields supplied
   in the partial are returned for persistence; unrelated defaults do not create
   extra patch fields.
6. The operation continues through its data-plane transaction/commit guard and
   normal mutation acknowledgment. Browser success waits for acceptance, not
   merely an optimistic local change.

Fabric tenant Sync performs the corresponding actor-backed row lookup and
validation. The logical schema remains the same while authority, readiness and
physical execution belong to the relevant plane. See [runtime data planes](../runtime/data-planes.md)
for the system/application/tenant distinction.

Delete does not run the full logical row validator. It still requires the
appropriate authorization, row identity, database integrity and mutation contract.

## Absent Values In Patches

Optional strings/single choices allow blank and null without accepting invalid
nonblank values. Optional Guardian references allow omission/null but reject
blank IDs; foreign-key existence and live assignment authority are separate
checks. Optional numeric null is an explicit clear. These values survive a merged
update even when the existing row contains SQL NULL.

```ts
const patch = { quantity: null };
// Valid only when quantity is declared optional.
// JSON retains null; an undefined quantity would disappear from the payload.
```

A default is only used for omission under its field validator. It must not
overwrite a deliberate nullable clear. Required scalar/reference null remains
invalid. Array/dateRange/boolean codecs keep their existing neutral representations;
do not infer arbitrary nullability from the SQL column hint alone.

## Forms And Inline Editing

Generated forms/headless useForm validate field values before invoking their
submission path. Their callback receives descriptor-encoded row values, not a
promise that its generic T is the parsed logical output. Collection paths await
insertAsync/updateAsync receipts. A custom onSubmit must itself return the promise
for its complete server operation.

Inline editors likewise await their writer and configured refresh. A cell's
metadata chooses the control/value representation; the server remains the final
validator. Applications with custom writers should not bypass the normal
authenticated SDK or declare success before that writer accepts the change.

Unknown/hidden fields in a UI do not grant assignment rights. Server policy must
derive or validate ownership; see [Guardian references](./guardian-references.md#existence-is-not-permission).

## Errors And Safe Presentation

Ordinary logical failures contribute bounded field paths/messages. A codec/custom
validator exception is not exposed as arbitrary SQL, file paths, stack traces or
row contents; the boundary uses safe logical-validation failure text. Actor-backed
mutation rejection uses its standard database error boundary, including
DATABASE_PAYLOAD_INVALID when logical mutation validation fails.

Use the SDK's normal rejected-mutation handling and component lifecycle feedback.
Do not log raw form values, passwords, identity credentials or provider payloads.
Declaring a schema installs no separate logger; [runtime observability](../runtime/observability.md)
owns standard logging and sink behavior.

## Verification And Compatibility

Focused checks should prove a valid insert, invalid required/nonblank input,
unknown-field rejection, merged partial update, immutable primary key and the
intended optional clear. For Fabric, repeat relevant checks under tenant authority,
not a raw unscoped service. Schema tests exercise fresh in-memory SQLite and the
actual validator/change delivery; browser tests exercise actual AutoForm behavior
without app/provider/live data.

The audited correction preserves optional SQL NULL instead of blocking unrelated
updates of existing nullable rows. It also stops invalid declaration defaults
at construction. Those corrections are not an automatic database migration or
a relaxation of existing required/tenant/role checks. Installed-package examples
and broader mode qualification are still a distinct release gate.

## Related Guides And Next Steps

- [Fields](./fields.md) specifies exact validators/default/absence rules.
- [Types](./types.md) separates logical input/output from stored rows.
- [Codecs](./codecs.md) explains representation conversion.
- [Guardian references](./guardian-references.md) owns reference integrity and authority.
- [Runtime server services](../runtime/server-services.md) explains normal scoped execution.
