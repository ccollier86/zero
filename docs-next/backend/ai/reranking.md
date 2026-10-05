---
id: zero.ai.reranking
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: document-reranking
maturity: supported
applies_to: ["2.1.1 source baseline"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Rerank Documents

[Zero AI](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Reranking scores an already selected, authorized document set against a query.
It is useful after retrieval; it does not fetch inaccessible records, create a
search index or confer permission to return a selected document.

## Minimal Service Function

Complete function with an app-bound reranking-capable service:

```ts
import type { AIService } from '@zero/framework/ai';

export async function rankCandidates(ai: AIService, query: string, documents: readonly string[]) {
  const result = await ai.rerank({ query, documents, topN: 3 });
  return result.ranking.map(item => ({
    sourceIndex: item.originalIndex,
    score: item.score,
    document: item.document,
  }));
}
```

This example requires at least 3 documents because topN must not exceed the
input count. Adapt topN deliberately when fewer candidates are present rather
than relying on silent clamping. The returned originalIndex addresses the
submitted array, not a database primary key.

## Request And Result

AIService.rerank<VALUE,RUNTIME_CONTEXT>(AIRerankRequest) returns a
Promise<AIRerankResult<VALUE>>. VALUE is a string or a plain JSON object.
The entire documents array must use one kind; strings and objects cannot be
mixed. Object documents are deeply snapshotted/frozen before provider execution.

Inputs are model (default reranking alias), nonblank query, documents, optional
topN, maxRetries, abortSignal, headers, providerOptions, metadata, runtimeContext,
telemetry, onStart and onEnd. There is no text-generation timeout field.
The SDK result retains originalDocuments, rerankedDocuments, ranking, response
and optional provider metadata.

Each ranking entry has originalIndex, score and document. Scores are finite
provider outputs, not a normalized probability, authorization decision or
cross-model comparable quality metric. The provider may return fewer results
than topN; Zero verifies coherent bounded results rather than inventing missing
scores/documents.

## Bounds And Admission

| Input | Rule |
| --- | --- |
| query | Nonblank string, at most 64 KiB UTF-8. |
| documents | Nonempty homogeneous array, at most 10,000. |
| One document | At most 1 MiB; plain JSON objects only for object mode. |
| Aggregate documents | At most 16 MiB. |
| topN | Integer1 through submitted document count; omitted delegated to provider. |
| maxRetries | Supplied integer 0–10. |

JSON object input rejects nonfinite numbers, unsupported values, accessors,
hidden properties, custom prototypes, sparse arrays and cycles. It uses bounded
allocation-aware snapshots, not untrusted JSON.stringify callbacks.
Headers/providerOptions have their common
[snapshot contract](./generation-controls.md#bounded-mutable-inputs).

## Provider Integrity And Errors

Zero verifies unique in-range indices, finite scores, bounded result count,
identity correspondence among ranking/reranked/original documents, and coherent
response metadata. Invalid raw/aggregate provider responses raise
AI_PROVIDER_RESPONSE_INVALID. Invalid input raises AI_REQUEST_INVALID; fixed
capacity violations raise AI_REQUEST_LIMIT_EXCEEDED.

Provider capability/readiness is checked before execution. Bedrock reranking
uses its independently resolved Agent Runtime endpoint and still requires a
region; language inference readiness alone is not reranking readiness. See
[Bedrock settings](./provider-settings.md#amazon-bedrock).

## Authority And Integration

Retrieve authorized candidates first and include an app-owned stable ID in
object documents when results must be joined back to database records. Re-check
live authority before a later protected action; a reranked result is not a
durable permission grant. Keep private document/query content out of standard
public logs. No row/cache/index is written automatically by rerank.

## Verification And Related Guides

Use provider doubles to assert exact query/document snapshots, input kind
admission, topN bounds, duplicate/out-of-range indices, wrong documents and
metadata integrity. Test Bedrock endpoint separation independently of a normal
language call. Avoid live records/provider accounts in framework tests.

[Embeddings](./embeddings.md) can support the retrieval stage; it does not
replace reranking. [Configuration](./configuration.md) chooses the model alias.
[Providers](./providers.md) describes supported adapter maxima. Return to
[Zero AI](./index.md) for service and durability composition.
