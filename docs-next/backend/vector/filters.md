---
id: zero.vector.filters
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: filters
maturity: supported
applies_to: ["2.1.1 baseline with unreleased scope/capacity corrections"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Structured Vector Filters

[Vector index](./index.md) · [Documentation index](../../index.md)

VectorFilter is a structured expression, not raw SQL. The adapter compiles
safe field identifiers and scalar literals against its configured field set.

```ts
import { buildZvecFilter } from '@zero/framework/vector';
import type { VectorFilter } from '@zero/framework/vector';

const filter: VectorFilter = {
  $and: [
    { tenantId: 'server-bound-organization' },
    { published: true },
    { source: { in: ['manual', 'reference'] } },
  ],
};
export const expression = buildZvecFilter(
  filter, new Set(['tenantId', 'published', 'source']),
);
```

Pass the filter object to the service; the compiler example illustrates validation,
not an invitation to send compiled expressions from a browser.

## Operators

Direct string/number/boolean means equality; null means IS NULL; an array means
membership. Operator objects support eq/ne/gt/gte/lt/lte/in/notIn/exists/like.
$and and $or compose nested expressions. Empty/invalid operator objects and
undeclared fields reject with VECTOR_FILTER_INVALID.

id and text are supported built-in fields. Additional filter fields must be
promoted scalar metadata. Full JSON metadata is not automatically a queryable
nested document language.

## Scope Composition

mergeVectorFilters combines required and caller filters with AND.
Simple equality requirements can stamp scoped writes; compound predicates must
be satisfied by the complete candidate rather than being guessed into metadata.
Conflicting equality requirements reject.

Scope construction detaches/freezes valid cloneable filter data. Invalid cyclic
filters reject safely rather than recursing indefinitely.

See [metadata declarations](./indexes.md), [scopes](./scopes.md),
[queries](./queries.md), [deletes](./deletes.md) and [errors](./errors.md).
