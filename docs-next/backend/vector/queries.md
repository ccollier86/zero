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
applies_to: ["2.6.0 unreleased working tree"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Similarity, Lexical and Hybrid Queries

[Vector index](./index.md) · [Documentation index](../../index.md)

`query`/`search` accepts dense vectors, explicitly enabled lexical text, a scalar
filter, or a compatible combination. A query without any of those is invalid.
The index is explicit or defaults to the configured `defaultIndex`.

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

## Lexical and Hybrid Retrieval

Enable `lexical: true` on the [index configuration](./configuration.md) before
using full-text queries. Lexical retrieval searches the native text index,
including records absent from a dense candidate set. Hybrid retrieval runs dense
and lexical legs with the same filter and combines them through reciprocal-rank
fusion; it is not a keyword score applied only to vector matches.

```ts
const lexical = await vectors.query('documents', {
  retrieval: 'lexical', text: 'rotate API key', topK: 10,
  filter: { tenantId: currentTenantId },
});

const hybrid = await vectors.query('documents', {
  retrieval: 'hybrid', vector: embedding, text: 'rotate API key',
  topK: 10, candidateCount: 30, rankConstant: 60,
  filter: { tenantId: currentTenantId },
});
```

Use a trusted `VectorScope` for application authorization; the filter above is
only a query example, not an authority boundary. Lexical mode requires text and
no vector; hybrid requires both. Dense mode must not contain lexical text.
When `retrieval` is omitted, a native query containing text selects lexical or
hybrid according to whether it also contains a vector. Existing AI bridge
`embedAndQuery` calls remain dense unless their retrieval mode is explicit.

`candidateCount` controls each native hybrid leg and must be at least `topK`,
with an upper bound of 1,000. `rankConstant` defaults to 60 and accepts integers
from 1 to 10,000. Native lexical/fusion scores and dense distances are different
quantities; never present them as interchangeable probabilities.

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
limits. The optional [visualization surface](./visualizations.md) supplies bounded,
Guardian-authorized commands and observation; it is not an unrestricted vector
router or an exact-total/cursor pagination contract.

See [filters](./filters.md), [scopes](./scopes.md), [tuning](./tuning.md),
[records](./records.md) and [errors](./errors.md).
