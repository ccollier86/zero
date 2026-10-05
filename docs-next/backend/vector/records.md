---
id: zero.vector.records
type: how-to
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: records
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

# Write And Fetch Vector Records

[Vector index](./index.md) · [Documentation index](../../index.md)

A VectorRecord contains id, vector, optional text and optional metadata.
vector accepts number[] or Float32Array. IDs must be valid nonempty identities;
the adapter validates dimensions/finite values and promoted metadata types.

```ts
import type { VectorService } from '@zero/framework/vector';

export async function storeChunk(vectors: VectorService, embedding: number[]) {
  const result = await vectors.upsert('documents', {
    id: 'chunk-001',
    vector: embedding,
    text: 'A reusable explanation.',
    metadata: { tenantId: 'trusted-server-bound-organization', source: 'manual' },
  });
  if (!result.ok) return { ok: false as const, issues: result.errors.length };
  return { ok: true as const, count: result.count };
}
```

The tenant metadata above is illustrative; it is not an authorization check.
Use [scope integrity](./scopes.md) when exposing tenant-bound writes.

## Write Results

upsert accepts one record or an array and targets an explicit or default index.
Its result is {ok,count,errors}; native per-record issues can make ok false without
throwing the entire operation. Awaiting a promise alone is therefore insufficient
to declare every submitted record stored.

Queued service writes detach caller-owned record data. Their IDs/vector/metadata
cannot be changed by mutating the original input while a previous write waits.

## Fetch Results

fetch/get accepts one or several IDs, optionally includeVector/outputFields.
StoredVectorRecord includes id, metadata and optional text/vector/score. Embeddings
are opt-in to avoid returning unnecessary large arrays. Full metadata and text
still require application-level output authorization.

Scoped fetch checks required metadata after lookup and omits other-scope records.
Do not infer existence of a foreign record from an empty result.

See [queries](./queries.md), [deletes](./deletes.md), [errors](./errors.md),
[AI composition](./ai-integration.md) and [configuration](./configuration.md).
