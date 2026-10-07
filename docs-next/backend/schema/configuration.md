---
id: zero.schema.configuration
type: reference
audience: [developer, agent]
owner: schema
status: verified
visibility: internal
system: schema
feature: configuration
maturity: supported
applies_to: ["2.6.0"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Schema Declaration Configuration

[Schema index](./index.md) · [Documentation index](../../index.md)

Schema settings are TypeScript declaration inputs. They have no implicit
environment-variable bindings, persisted settings table or runtime reload
mechanism. App code may import ordinary modules to organize declarations; doing
so executes trusted code. Do not put server secrets in modules shared with the
browser.

## Descriptor Options

`defineSchema(fields, { pk?, identity? })` accepts:

| Option | Accepted value | Omitted behavior |
| --- | --- | --- |
| `pk` | primary-key field name | `id`; generated in server/client conversion if absent from fields |
| `identity` | ordered string field-name list | no natural identity; empty high-level list also means none |

`toTableSchema` accepts the same overrides. `toClientTableDef` also accepts
`sync`. Keep overrides aligned; prefer [table definitions](./tables.md) when both
projections are needed.

## Table Options

`defineTable(name, fields, { pk?, identity?, sync? })` adds:

| Option | Accepted value | Effect |
| --- | --- | --- |
| `sync` | full, lazy or auto | records client loading-mode intent; omission delegates to app defaults |

In the corrected development source, declared loading intent also travels with
the raw server table, so `tables: schemaResult.serverTables` preserves it at
managed resolution. An explicit per-table `syncDefaults.tables[name].mode`
overrides declaration intent; then the declaration wins over the global default.
This is loading policy, not authorization or physical placement. Serializing a
server table to JSON discards executable/symbol metadata and is not a supported
composition path.

`schema({ tableName: { fields, pk?, identity?, sync? } })` applies those settings
per table. `fields` is required. No `tenant`, `database`, `role`, `permissions`,
`encrypted`, `embedded` or `trigger` option is implied by this table API.
Physical placement, authorization and automations use their separate declarations.

## Field Options

Builder options are not interchangeable. The following table records the
accepted option families; the focused field reference supplies validators and
wire representations as it is completed.

| Builders | Accepted options beyond their choice/value arguments |
| --- | --- |
| text, email, url, password, textarea | label, placeholder, description, required, defaultValue, minLength, maxLength, tableVisible, sortable, filterable, columnWidth |
| phone | label, placeholder, description, required, defaultValue, defaultCountry, validation, tableVisible, sortable, filterable, columnWidth |
| number | label, placeholder, description, required, defaultValue, min, max, integer, tableVisible, sortable, filterable, columnWidth |
| boolean | label, description, required, defaultValue, tableVisible, sortable, filterable, columnWidth |
| select, enum | label, placeholder, description, required, defaultValue, tableVisible, sortable, filterable, columnWidth |
| multiSelect | label, description, required, defaultValue, tableVisible, sortable, filterable, columnWidth |
| date, datetime | label, placeholder, description, required, defaultValue, tableVisible, sortable, filterable, columnWidth |
| json | label, description, required, defaultValue, tableVisible, sortable, filterable, columnWidth |
| tags | label, placeholder, description, required, defaultValue, maxTags, tableVisible, sortable, filterable, columnWidth |
| combobox | label, placeholder, description, required, defaultValue, multiple, searchable, optionIcon, optionDescription, tableVisible, sortable, filterable, columnWidth |
| dateRange | label, placeholder, description, required, tableVisible, sortable, filterable, columnWidth |
| hidden | defaultValue only |

Choice arguments for select/multiSelect/combobox are label/value pairs. Enum
takes a nonempty string-literal tuple and derives labels. Use `defaultValue`,
not `default`. A builder accepting an option does not imply every option changes
SQL validation: presentation metadata and logical constraints are distinct.

## Phone Options

Phone options in Zero 2.6.0 separate canonical backend admission from generated
input presentation. A default country is a UI hint, not server-side conversion.

| Phone option | Accepted value | Default / effect |
| --- | --- | --- |
| required | boolean | false; required rejects omitted, blank and null values |
| defaultValue | canonical E.164 string or optional null | omission defaults to `''`; an explicit default must pass the same validator as supplied values |
| defaultCountry | supported two-letter `PhoneCountry` | `US`; generated input presentation only, not server normalization |
| validation | `possible` or `valid` | `possible` checks calling code and number length; `valid` also checks current numbering-plan patterns |
| label, placeholder, description | string | ordinary generated field label, prompt and help text |
| tableVisible, sortable, filterable, columnWidth | existing table metadata types | ordinary table presentation eligibility and width |

Invalid `defaultCountry` or `validation` declarations throw static, value-free
TypeErrors. An invalid `defaultValue` uses `SchemaConfigurationError` with
`SCHEMA_DEFAULT_INVALID`. The builder stores TEXT, not a new SQL type, and
adds NOT NULL only when required. It emits no SQL DEFAULT clause. Both
validation modes accept only canonical international nonblank strings; neither
verifies the subscriber or adds SMS/MFA functionality. See [phone fields](./fields.md#phone-fields)
and the [PhoneInput reference](../../frontend/components/phone-input.md).

## Defaults And Read Time

Declarations read options when constructed. Ordinary fields default
required=false; Guardian references default required=true. Boolean defaultValue
is false. Password's minimum length defaults to 8 and its table visibility is
forced false. Number's integer defaults false; combobox multiple defaults false.
Other optional presentation metadata remains undefined unless supplied.

Descriptor defaults, Valibot defaults and SQL column defaults are not one
universal mechanism. `getDefaults` supplies initial values to forms;
field validators may supply parsed values for omitted properties; only builders
with emitted SQL DEFAULT clauses affect a raw SQLite insert. Always validate a
logical record and use [codecs](./codecs.md) where required.

Changing a declaration requires re-admission/restart and any relevant schema
migration. It does not automatically update an existing SQLite table or a
browser client already holding old table metadata. Client projection is
descriptive; executable mutation/reference metadata remains server-only.

## Guardian Reference Options

User/membership references accept label, description, required, tableVisible,
sortable, filterable and columnWidth. They do not accept arbitrary FK targets or
delete cascades. Targets and delete RESTRICT are platform-owned. Membership
references require multi tenancy; all Guardian references require auth.
See [reference admission](./guardian-references.md#options-and-admission).

## Diagnostics And Security

Use trusted synthetic configuration for diagnostics. Doctor's config/resource
loading executes modules; read-only inspection is not a promise of static-only
execution. Do not run a declaration example as a migration against live data.

Invalid identity declarations fail immediately. Wrong installed managed FKs
fail readiness with stable database errors. Hidden/password/tableVisible=false
metadata does not redact stored data or authorize a request. Configure server
resource policies and canonical Guardian services separately.

The corrected development builders reject an invalid explicit `defaultValue`
with `SchemaConfigurationError` / `SCHEMA_DEFAULT_INVALID`, without including
the supplied value in its message. Optional scalar nulls and constrained omitted
numeric defaults are handled deliberately; required values retain their normal
constraints. See [descriptor defaults](./descriptors.md#defaults-are-not-a-completed-form).

## Related Guides And Next Steps

- [Descriptors](./descriptors.md) explains defaults and conversions.
- [Tables](./tables.md) owns installation/composition fragments.
- [Natural identity](./natural-identity.md) details supported key values/order.
- [Guardian references](./guardian-references.md) owns exact anchor requirements.
