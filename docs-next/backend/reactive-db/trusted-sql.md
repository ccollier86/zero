---
id: zero.reactive-db.trusted-sql
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: trusted-sql
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Raw SQL And Introspection Are Privileged

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`exec(sql)` and `prepare(sql)` expose trusted Bun SQLite work.
`getRawDatabase()` returns the backing Database;
`getSQLiteService()` returns its platform service or null for raw injection.

These methods do not add Resource/Guardian checks or guarantee managed change
tracking. A raw UPDATE must not be presented as automatically causing Sync,
automations or durable workflow resumption.

## Introspection

`getTableNames`, `hasTable`, `getPrimaryKey` and `getColumns` inspect
registered engine tables. Name/column arrays are copies; unknown required table
lookups reject. `getTransactionDomain()` returns an opaque instance identity
for trusted cooperating stores, not a database path or mutation capability.

Registered tables and every SQLite catalog object are not necessarily the same
set. Do not expose internal table names/SQL handles to ordinary clients.

## SQL Safety

Parameterize values. Validate/quote identifiers through the supported
declaration/query layer rather than interpolating untrusted table names.
Keep DDL-only work separate from tracked writes; managed schema fences reject
unsafe drift.

Do not modify protected change-log state/triggers or append invented internal
changes after arbitrary SQL. The engine's internal recording/commit seams are
for platform infrastructure, not a retrofit CDC API.

## Managed Applications

Multi-tenant request contexts block raw database/SQL/system handles unless trusted
app code deliberately crosses `zero.unsafe`. Strict machine projections expose
none of them. Such privileged code must enforce current application authority
and derive target scope server-side.

A table editor should use Data Studio's admitted contracts, not accept browser
SQL and run it on a system handle.

## Verify

Test query parameterization/identifier admission and deny raw exposure on
ordinary multi-tenant requests. Check that raw maintenance does not silently
claim a corresponding tracked event or an authorization grant.

## Related Guides And Next Steps

- [Request services](../runtime/server-services.md) defines raw-access rejection.
- [Schema admission](./schema-admission.md) defines managed table contracts.
- [Automation integration](./automation-integration.md) requires tracked mutations.
