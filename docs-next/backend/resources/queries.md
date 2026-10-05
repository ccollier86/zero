---
id: zero.resources.queries
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: queries
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Bounded Search, Filtering And Sorting

[Resources index](./index.md) · [Documentation index](../../index.md)

Resource query planners turn client controls and server-owned policy constraints
into parameterized SQL or Fabric structured find input. They never concatenate
a user-authored SQL WHERE statement.

## HTTP Query Vocabulary

- filter accepts repeatable expressions field:value (equality) or
  field:operator:value.
- Operators are eq/ne/gt/gte/lt/lte/like/contains/in.
- search is bounded text matched over explicit searchField values.
- sort is repeatable field:asc or field:desc.
- Legacy order plus dir remains available, but cannot mix with sort.
- limit/offset select a bounded page; default100, maximum1000.

For example:

```text
GET /api/resources/notes?search=report&searchField=title&sort=title:asc&limit=20&offset=0
```

Use URLSearchParams/official SDK encoding for actual values containing reserved
characters; this illustrative line is not a raw concatenation recipe.

## Constraints And Columns

Client filters/order/search fields must pass schema and resource field admission.
Server realm/policy equality uses exact storage-class/BINARY matching where
needed so SQLite affinity/collation does not broaden an authorization predicate.

Server constraints are ANDed with client controls, never replaced by them.
Projected output is distinct from the full server row used for authorization.
Do not filter or sort hidden columns to infer protected values.

## Page And Limits

Planners fetch a lookahead row for has-more behavior rather than requiring an
expensive exact count. SQL and actor find plans share logical limits;
the actor maximum1001 accommodates a1000-row page plus lookahead.

Filter nodes, expression length, search/control lengths, projected/order fields,
bind parameters and offsets remain bounded. Invalid identifiers/operators or
control combinations return validation errors, not a fallback full-table scan.

Keep the UI's server page ordered IDs separate from its shared reactive record
cache; cached records from another query do not belong to this result.
Do not apply client pagination/filtering again to an already-filtered server page.

See [generated CRUD](./crud.md), [field access](./field-access.md),
[Fabric operations](../fabric/operations.md) and
[frontend tables](../../frontend/data-controls/index.md).
