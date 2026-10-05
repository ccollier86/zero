---
id: zero.configuration.data-access
type: reference
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: data-access
maturity: supported
applies_to: ["2.1.1 baseline with unreleased Schema corrections"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Separate Policy From Loading Mode

[Configuration index](./index.md) · [Documentation index](../../index.md)

Resources describe exposure and business access; Sync controls live
data admission/fanout; table loading settings choose how authorized rows are
loaded. A lazy table is not automatically private, and a full table is not
automatically public.

## Policy Inputs

`resources` declares app Resource definitions. Conventional server Resource
modules are also discovered. `resourceRoutes` is enabled by default at
`/api/resources`; false omits generated CRUD but does not remove the registry.

`syncPolicy` is a trusted policy for app-owned tables. Managed platform defaults
and Resource policy compose deny-wins: an app callback cannot widen a framework
denial. Multi-tenant data must have an admitted boundary, not a client-supplied
tenant column or selector.

`ephemeralPolicy` admits custom collaboration topics and returns server-derived
internal namespaces. Built-in presence/typing/current-user channels have
reserved handling. A string channel name alone is not authorization.

## Loading Options

| Setting | Omitted default | Meaning |
| --- | --- | --- |
| `syncDefaults.defaultMode` | auto | fallback when table/config has no explicit mode |
| `syncDefaults.autoLazy.rowLimit` | 1000 | startup row-count threshold |
| `syncDefaults.autoLazy.action` | lazy | lazy, warn or reject for an oversized auto table |
| `syncDefaults.autoLazy.persist` | true | persist eligible auto decisions in system metadata |
| `syncDefaults.tables[name]` | none | mode string or per-table object |
| per-table `mode` | none | explicit mode override |
| per-table `rowLimit/action/persist` | global values | per-table auto behavior |

Invalid/nonfinite/sub-one row limits fall back; finite positive fractions are
floored. Do not document them as a hard integer rejection contract.

Corrected development loading precedence is per-table config mode, shared table
declaration, then global default. `schema().serverTables` now carries declaration
intent through server resolution. It does not insert a fake SQL column.

## Startup Decisions

For a shared app table, explicit full/lazy resolves directly. Auto uses the
startup row count: over the limit, lazy changes mode; warn keeps full with a
warning; reject fails admission. A persisted lazy decision is retained under
lazy action instead of flipping back after later shrinkage.

For isolated tenant-database tables, no default shadow count can represent the
fleet. Auto conservatively resolves lazy without a global count/persisted
decision; explicit full/lazy remains explicit. This avoids mistaking an empty
default app table for every organization's actual data.

These are startup decisions, not a promise of continuous mode switching on
every inserted row. Browser loading/query controls consume the resolved policy
while server authorization still filters each operation.

## Verify Both Axes

Use separate checks for exposed/denied fields and for full/lazy behavior.
Exercise row-count threshold, restart persistence, explicit overrides and
tenant-file mode without touching live app data.

Then test cross-organization and live revocation boundaries; a table whose
snapshot is small enough may still be forbidden to the actor.

## Related Guides And Next Steps

- [Schema tables](../schema/tables.md#sync-and-physical-placement) carries loading intent.
- [Reactivity](../../concepts/reactivity.md) connects committed rows to frontend state.
- [Request services](../runtime/server-services.md) distinguishes file binding from business policy.
- [Guardian](../guardian/index.md) owns the actor's live permission decisions.
