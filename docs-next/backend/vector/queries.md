---
id: zero.vector.queries
type: how-to
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: queries
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

# Similarity And Scalar-Only Queries

[Vector index](./index.md) · [Documentation index](../../index.md)

query/search accepts a vector, a filter, or both. A query without either is
invalid. The index is explicit or defaults to the configured defaultIndex.

```ts
import type { VectorService } from '@zero/framework/vector';

export async function findChunks(vectors: VectorService, embedding: number[]) {
  return vectors.query('documents', {
    vector: embedding,
    topK: 10,
    filter: { source: 'manual' },
    includeVector: false,
  });
}
```

A scalar-only query omits vector and supplies a structured filter. It does not
invoke an embedding model. AI text queries require the [bridge](./ai-integration.md).

## Result And Projection

topK defaults to 10. minScore keeps results whose native score is at least the
requested threshold; scores absent from the adapter do not satisfy a threshold.
includeVector defaults off. outputFields selects known text/metadata/scalar
fields; invalid names fail before native query construction.

Dimensions and metric determine score semantics. Native score is not guaranteed
to be a calibrated probability, and a threshold cannot be copied across every
embedding/model/index combination without measurement.

## Scope And Concurrency

VectorScope ANDs required scope with caller filters. A caller cannot widen
scope through an OR in its extra expression. Same-service reads can progress
independently of write queues; this is not a repeatable-read transaction spanning
multiple operations.

An app-facing endpoint must impose its own authorization and appropriate request
limits. There is no built-in public vector router or exact-total/cursor pagination
contract to assume.

See [filters](./filters.md), [scopes](./scopes.md), [tuning](./tuning.md),
[records](./records.md) and [errors](./errors.md).
