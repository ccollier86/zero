---
id: zero.inventory.schema
type: inventory
audience: [maintainer, agent]
owner: schema
status: in-review
visibility: internal
system: schema
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Schema And Typed Field Definitions Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

One declaration supplies validation, UI metadata, SQL table definitions, client table descriptors, inference, and explicit Guardian reference metadata. Schema describes data, not permission: resource/Guardian policy remains a separate server-side boundary.

This source/contract inventory uses the original baseline above. The documentation
branch now has separately authorized source/test corrections recorded in the
[findings ledger](../findings.md). Source inspection and tests present are recorded
below; no test, migration, provider call, or live data check is claimed as passed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A **field definition** combines validation, SQL encoding, and presentation
metadata. A **schema descriptor** describes one logical row. A **table
definition** adds the primary key, Sync loading mode, natural identity, and
server-only mutation metadata. Guardian reference annotations describe shallow
storage anchors only; they do not grant or resolve authority.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Planned canonical guide |
| --- | --- | --- | --- |
| Field builders | `field`: text/email/url/password/number/boolean/select/multiSelect/textarea/date/datetime/hidden/json/enum/tags/combobox/dateRange | `field-types.ts`: Valibot + metadata + SQL encoding | [Draft field guide](../../../backend/schema/fields.md) |
| Schema descriptors | `defineSchema`, `schema`, `SchemaDescriptor` | Ordered fields, defaults, validate, field/row codecs, SQL/client conversion | [Draft descriptors guide](../../../backend/schema/descriptors.md) |
| Table definition | `defineTable`, `TableDefinition`; custom `pk`, sync mode, natural identity | `define-schema.ts`: declaration projections/server logical validator; not universally frozen | [Draft tables guide](../../../backend/schema/tables.md) |
| Type inference | `InferSchemaType`, `InferSchemaInput`, `InferRow`, `InferInsert`, `InsertInput`, `PrimaryKeyOf` | Valibot output vs insert input and configured primary key | [Draft inference guide](../../../backend/schema/types.md) |
| Registry augmentation | `Register`, `TableNames`, `TableRow` | Typed app declaration merge, no runtime register-by-type implication | [Draft registry guide](../../../backend/schema/registry.md) |
| UI metadata | labels/placeholders/descriptions/options/required/defaults/table visibility/sort/filter/width | Consumer forms/table hooks use schema metadata; not DB authorization | [Draft UI metadata guide](../../../backend/schema/ui-metadata.md) |
| Field and row serialization | `decodeFieldValue`, `encodeFieldValue`; descriptor `decodeField/encodeField/decodeRow/encodeRow` | Booleans and structured SQL TEXT map to logical values; tests present | [Draft codecs guide](../../../backend/schema/codecs.md) |
| Logical validation for Sync | `mutationValidator`, `SYNC_TABLE_MUTATION_VALIDATOR` | Server-only validation metadata excluded from SQL/client serialization | [Draft validation guide](../../../backend/schema/validation.md) |
| Natural identity | `identity`, `_identity`; deterministic generated sync key and unique index | ReactiveDB/client identity helpers; identity fields immutable | [Draft natural identity guide](../../../backend/schema/natural-identity.md) |
| Guardian user/membership FKs | `field.guardianUser`, `field.guardianMembership`; reference metadata inspection | Non-enumerable server metadata; shallow managed FK anchors, not authorization | [Draft reference guide](../../../backend/schema/guardian-references.md) |

## Public Surface Map

- `@zero/framework/schema` exports `field` and field metadata/types,
  `defineSchema`, `defineTable`, `schema`, descriptor/table/client types, and the
  `Infer*`, `InsertInput`, and `PrimaryKeyOf` helpers.
- It also exports `decodeFieldValue`/`encodeFieldValue`, registry augmentation
  types (`Register`, `TableNames`, `TableRow`), and Guardian reference anchor,
  reference, presence, and installed-schema inspection APIs/types.
- A table without an explicit primary key receives logical `id`; natural
  identity generates a deterministic Sync identifier and unique index rather
  than a composite SQL primary key.
- Logical mutation validators and Guardian references are server metadata and
  are excluded from serialized client/SQL shapes. UI metadata is descriptive,
  not an authorization surface.

## Configuration Inventory

`defineSchema(fieldDefs, { pk?, identity? })`; `defineTable(name, fieldDefs, { pk?, sync?, identity? })` are authored before app startup. Default key is `id`; generated server key has supported TEXT identity. Sync modes are full/lazy/auto (omission enters app defaults). `FieldMeta` includes type, label, placeholder, description, required, defaultValue, options, min/max, minLength/maxLength, tableVisible, sortable, filterable, columnWidth, maxTags, searchable, multiple, optionIcon, optionDescription. Builder-specific options are narrower. Required/default/conversion behavior must be documented per builder, not inferred from one generic interface. Guardian references always restrict deletion and require the managed identity projection readiness barrier.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

1. Server `tables` accepts defineTable outputs or raw SQL definitions; browser setup uses `clientTable`, not server executable policy.
2. Valibot validation concerns logical values; codecs bridge SQLite/wire representations and form/table editing.
3. ReactiveDB requires one TEXT/INTEGER primary key; natural multi-field identity is not a composite sync primary key.
4. Guardian references request storage anchors. Canonical identity/profile/suspension/role authority stays in system DB; a mirror proves FK existence only.
5. Resource fields/policies enforce read/write/tenant limits independently from form visibility.

## Evidence And Verification

Implementation and the complete schema subpath barrel were inspected. The two
direct schema tests (`define-schema` and `field-codecs`) and schema use in the
Fabric, Guardian/Fabric proof, and package-mode examples are present; no example
or test was run in this pass.

- [src/schema/index.ts](../../../../src/schema/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/field-types.ts](../../../../src/schema/field-types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/define-schema.ts](../../../../src/schema/define-schema.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/guardian-references.ts](../../../../src/schema/guardian-references.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/field-codecs.test.ts](../../../../src/schema/field-codecs.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/define-schema.test.ts](../../../../src/schema/define-schema.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/schema/registry.ts](../../../../src/schema/registry.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/identity.ts](../../../../src/sync/identity.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/identity-projection-config.ts](../../../../src/frontend/server/identity-projection-config.ts): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

All exact builder signatures need individual reference coverage, even when grouped on one page. No composite-primary-key support should be implied. Client metadata is not an authority source. Source field-type unions do not alone prove renderer support for every field/mode; frontend-forms inventory reconciles this.

## Supplemental Schema Correction And Detailed Draft Closeout

This section records **dirty working-tree evidence on 2026-10-05**, not a
replacement claim about the clean source commit pinned above. The user authorized
focused defect fixes and tests; no application project, live database, environment
file, provider API or deployment was involved.

- Replaced erased FieldDef logical validator types and descriptor object entries
  with required/default-aware types. Literal choice/multiple flags, conservative
  dynamic flags, schema().definitions and custom primary keys retain their actual
  logical contracts. Stored-row phantoms remain separate from Valibot output.
  The original static fixture had 27 failed contract checks; the expanded current
  fixture passes, including public @zero/framework/schema Register augmentation.
- Optional formatted/single-choice blanks no longer fail merely because an
  untouched control has an empty value. Actual nonblank constraints remain.
  Optional scalar/reference SQL NULL survives merged validation; required null
  remains rejected. Optional Guardian omission never invents a blank ID.
- Descriptor defaults now use logical neutral arrays/tuples/JSON defaults and
  explicit password defaults. An optional constrained number with invalid
  implicit zero stays omitted; its actual numbers retain constraints. Explicit
  optional numeric clear is null across renderer/headless/inline UI, JSON patch,
  logical validation, fresh SQLite storage and reactive change delivery.
- Explicit invalid declaration defaults fail early with value-free
  SchemaConfigurationError, code SCHEMA_DEFAULT_INVALID, exported from the schema
  subpath only. This newly added public correction needs final package/export
  catalog qualification; it is not retroactively present in the pinned artifact.
- schema().serverTables and defineTable raw server projections now retain declared
  full/lazy/auto intent via private symbol metadata. Explicit per-table
  syncDefaults remains highest precedence; omitted declarations inherit the app
  default. Symbols remain outside SQL columns and JSON. No new public mode API
  or automatic SDK table-name binding was added; stale Register JSDoc was corrected.

Focused current-source command:

```sh
bun --no-env-file test src/schema/schema-inference.test.ts src/schema/field-configuration.test.ts src/schema/table-sync-metadata.test.ts src/schema/field-defaults.test.ts src/components/forms/auto-form-defaults.browser.test.ts src/hooks/use-form.test.tsx src/schema/define-schema.test.ts src/schema/field-codecs.test.ts
```

Result: **81 passed, 0 failed, 382 assertions across eight files**. The browser
tests build in memory and use synthetic intercepted pages; database tests open
fresh in-memory ReactiveDB/SQLite only. This supplements the independent UI
owner's 40-test/174-assertion runtime/browser matrix and the original failing
default runs. A separate independent reviewer executed inference/defaults/
descriptor/codecs tests: **45 passed, 0 failed, 205 assertions**, and found no
production contract issue. Current global `bun --no-env-file x tsc --noEmit`
completed with exit 0 after a test-only matcher type correction.

The five previously planned fields/types/registry/validation/UI metadata homes
are now real detailed draft guides and are linked in the Schema index. Their
dirty/source-observed metadata intentionally does not claim a qualified package.
Frontend manual integration, corrected-source/artifact freeze, navigation/example
review and publication exclusion remain final gates.

Final edge closeout: explicit maxLength:0 was ignored in text/textarea/password
through a truthiness guard. Three focused regressions failed before correction;
the guards now recognize zero while retaining required/nonblank constraints and
rejecting incompatible explicit defaults via SCHEMA_DEFAULT_INVALID. The final
default-admission + actual inline numeric suite passed **24 tests, 0 failed,
118 assertions**. The inline subset itself passed two tests/13 assertions,
using the independently authored synthetic browser fixture. These totals
supplement, not rewrite, the earlier eight-file run above.

## Known Future Plans

User proposals: schema-driven automatic AI embedding and downstream advanced schema behaviors, explicitly planned; do not invent embedding flags or auto-authorization flags.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/schema/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [ ] Whole-platform reconciliation complete.
- [ ] Important examples and artifact/package support qualified.
- [ ] Authoritative guides replace this ledger's planned paths.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
