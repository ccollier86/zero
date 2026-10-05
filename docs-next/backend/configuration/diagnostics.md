---
id: zero.configuration.diagnostics
type: operations
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: diagnostics
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configuration Diagnostics And Doctor Hints

[Configuration index](./index.md) · [Documentation index](../../index.md)

Doctor can evaluate trusted app configuration and Resource declarations.
It is not a static Markdown linter and should not be run against an unknown
project as if importing its config had no side effects.

## Config Discovery

The current conventional search order is:

1. ./zero.config.ts
2. ./zero.config.js
3. ./config/zero.config.ts
4. ./config/zero.config.js

An explicit config path can select a module. The loader recognizes
`config`, `appConfig`, `zeroConfig`, then default export in that precedence.
It imports the module and loads conventional Resources relative to the project
root (a config/ parent is treated specially).

Keep an exported config separate from the listening entry point. Importing a
module that also runs `app.listen`, migrations or provider calls executes those
actions; Doctor cannot turn them into static inspection.

## Indexed-Field Hints

`doctor.indexedFields` is a map from table name to readonly indexed column names.
Use it for non-unique indexes owned by app migrations/startup code that cannot
be inferred from the declaration alone.

```ts
// AppConfig fragment
doctor: {
  indexedFields: {
    tasks: ['created_at'],
  },
},
```

This says the migration manages that index. It does not create one, prove it
exists in production or replace a migration. Keep hints aligned with actual
installed schema and avoid treating them as an authority policy.

## Safe Verification

For docs/example checks, use inspected synthetic modules, explicitly controlled
environment values and disposable stores, with Bun's automatic env-file loading
disabled. Record which check executed config code or inspected database metadata.
Do not capture .env contents, credentials or live rows in the documentation tree.

Static typechecking validates types; a config admission check validates
interactions; a Doctor run can additionally inspect selected app declarations
and configured database metadata. Distinguish these evidence levels.

## Related Guides And Next Steps

- [Declaration](./declaration.md) keeps config modules separate from listeners.
- [Resolution](./resolution.md) explains what normalization can prove.
- [Directories](./directories.md) relates Resource discovery to configured roots.
- [Schema configuration](../schema/configuration.md#diagnostics-and-security) explains declaration/FK diagnostics.
