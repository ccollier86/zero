# AI Embeddings And Reranking

Zero exposes provider-neutral single and batch embeddings plus bounded document
reranking through `AIService`. These operations use the same provider registry,
aliases, cancellation, telemetry, and stable errors as text generation.

## Single And Batch Embeddings

```ts
const one = await ai.embed({
  model: 'embedding',
  value: 'ReactiveDB provides realtime application state.',
});

const batch = await ai.embedMany({
  model: 'embedding',
  values: [
    'Guardian owns identity and authorization.',
    'Fabric routes physically isolated tenant databases.',
    'Torrent runs durable workflows.',
  ],
  maxParallelCalls: 4,
});
```

`embedMany()` preserves input order: `batch.embeddings[index]` belongs to
`batch.values[index]`. Zero validates that the provider returns the same number
of finite, consistently sized vectors and fails an incoherent response with
`AI_PROVIDER_RESPONSE_INVALID`.

Use `maxParallelCalls` to bound provider calls after the adapter's own batching.
It defaults to `4` and accepts `1` through `32`.

## Reranking

```ts
const ranked = await ai.rerank({
  model: 'reranking',
  query: 'How does Zero isolate tenant data?',
  documents: [
    'Torrent persists workflow state.',
    'Fabric can route each tenant to its own SQLite database.',
    'Guardian supports application and tenant roles.',
  ],
  topN: 2,
});

for (const entry of ranked.ranking) {
  console.log(entry.originalIndex, entry.score, entry.document);
}
```

A request can contain all strings or all plain JSON objects. Do not mix the two
document forms in one call:

```ts
const rankedRecords = await ai.rerank({
  query: 'accounts with unresolved deployment risk',
  documents: accounts.map(account => ({
    id: account.id,
    summary: account.summary,
    risk: account.risk,
  })),
});
```

Object documents are defensively cloned, checked as bounded JSON, and frozen
for the operation. Circular references, accessors, sparse arrays, symbol keys,
non-finite numbers, and mixed document kinds are rejected before a provider
call. The result preserves each document's original index and validates that a
provider neither duplicates nor substitutes documents.

## Built-In Bounds

The service owns hard request limits so an untrusted batch cannot create
unbounded memory or provider work:

| Limit | Value |
| --- | --- |
| Values/documents per operation | 10,000 |
| One embedding value or rerank document | 1 MiB UTF-8/JSON |
| All embedding values or rerank documents | 16 MiB |
| Rerank query | 64 KiB UTF-8 |
| Embedding parallel provider calls | 1–32; default 4 |
| Retries | 0–10 |
| `topN` | 1 through the number of documents |

Malformed options use `AI_REQUEST_INVALID`; exceeded byte/count limits use
`AI_REQUEST_LIMIT_EXCEEDED` with status `413`.

## Context, Callbacks, And Provider Options

`embed()`, `embedMany()`, and `rerank()` accept:

- `abortSignal`
- `maxRetries`
- request `headers`
- `providerOptions`
- typed `runtimeContext`
- AI SDK `telemetry`
- `onStart` and `onEnd`
- Zero correlation `metadata`

The callbacks receive their original SDK events. Zero request telemetry never
copies values, documents, queries, embeddings, rankings, runtime context, or
provider options into framework-owned metadata.

## Models And Aliases

`embedding` and `reranking` are friendly aliases. Zero creates a default only
when an active capable provider matches its fixed candidates. Configure an
explicit alias when the deployment uses another model:

```ts
ai: {
  aliases: {
    embedding: 'bedrock/amazon.titan-embed-text-v2:0',
    reranking: 'cohere/rerank-v3.5',
  },
}
```

Environment overrides are `ZERO_AI_EMBEDDING_MODEL` and
`ZERO_AI_RERANKING_MODEL`. A provider capability indicates that its adapter can
resolve the operation; the chosen model must also implement it.

See [AI Providers](./ai-providers.md) for the current capability matrix.

## Vector Composition

Embeddings and vector persistence remain separate responsibilities. Generate
vectors with `AIService`, then store/search them with `VectorService`, or use
`createAIVectorBridge()` for the common embed-and-upsert path. Reranking is a
second-stage relevance operation: first retrieve a bounded candidate set from
the vector store, then rerank that set.

```ts
const candidates = await vectors.query('knowledge', {
  vector: queryEmbedding.embedding,
  limit: 30,
});

const reranked = await ai.rerank({
  query,
  documents: candidates.map(candidate => ({
    id: candidate.id,
    text: candidate.metadata.text,
  })),
  topN: 8,
});
```

Keep Guardian/Fabric scope in the vector query and app-owned record lookup.
AI model selection does not authorize access to tenant data.

## Related Documentation

- [AI](./ai.md)
- [AI Providers](./ai-providers.md)
- [AI Generation And Streaming](./ai-generation.md)
- [Vector Store](./vector.md)
- [Observability](./observability.md)
