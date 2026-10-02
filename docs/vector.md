# Vector Store

Zero includes an opt-in local vector store built on `@zvec/zvec`. It is a
server-side storage/search service for app-owned embeddings, documents, and
metadata.

The vector layer is intentionally separate from the AI layer:

1. `AIService` generates embeddings.
2. `VectorService` stores vectors and runs similarity/filter queries.
3. `createAIVectorBridge()` composes the two when you want one helper.

Zero does not provide native embedding generation, reranking, or public vector
routes in this slice.

## Enable Vectors

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  vector: true,
});
```

`vector: true` creates one local index named `default`:

| Setting | Default |
| --- | --- |
| `dataDir` | `ZERO_VECTOR_DATA_DIR` or `./data/vector` |
| `defaultIndex` | `default` |
| `dimensions` | `ZERO_VECTOR_DEFAULT_DIMENSIONS` or `1536` |
| vector field | `embedding` |
| text field | `text` |
| metadata JSON field | `_metadata` |

## Storage And Recovery

Zero uses zvec's native collection storage for vector durability. zvec provides
write-ahead logging for persisted collections, so Zero does not add a separate
vector journal/checkpoint layer.

Runtime behavior:

1. First access to an index opens the collection lazily.
2. If the configured path does not exist, Zero creates the collection.
3. If the configured path already contains a zvec collection, Zero reopens it
   with `ZVecOpen()` so zvec can recover through its own WAL.
4. Empty pre-created collection directories are treated as new paths and
   recreated.
5. `VectorService.dispose()` closes opened zvec collections on app shutdown.

This is different from SQL hot snapshots and Zero KV/cache recovery. Vector
storage currently uses zvec's file-backed durability. A future hot vector mode
should only be exposed if Zero can prove zvec supports memory-backed active
queries plus safe snapshot restore.

For production apps, explicit index config is better:

```ts
vector: {
  dataDir: './data/vector',
  defaultIndex: 'knowledge',
  indexes: {
    knowledge: {
      dimensions: 1536,
      metadata: {
        bucket: 'string',
        tenantId: 'string',
        source: 'string',
        year: 'number',
      },
    },
    products: {
      dimensions: 1024,
      metric: 'cosine',
      indexType: 'hnsw',
      metadata: {
        category: 'string',
        active: 'boolean',
      },
    },
  },
}
```

Number shorthand is accepted:

```ts
vector: {
  indexes: {
    docs: 1536,
  },
}
```

## Use From Server Code

```ts
import { getVectorStore } from '@zero/framework/server';

const vectors = getVectorStore();
if (!vectors) throw new Error('Vector store is not enabled.');

await vectors.upsert('knowledge', [{
  id: 'doc_1',
  vector: embedding,
  text: 'Install the Zero platform.',
  metadata: {
    bucket: 'docs',
    source: 'manual',
  },
}]);

const matches = await vectors.search('knowledge', {
  vector: queryEmbedding,
  topK: 8,
  filter: {
    bucket: 'docs',
    source: { in: ['manual', 'faq'] },
  },
});
```

Default-index calls can omit the index name:

```ts
await vectors.upsert({
  id: 'chunk_1',
  vector: embedding,
  text: 'A default-index chunk.',
});

const matches = await vectors.search({
  vector: queryEmbedding,
  topK: 5,
});
```

`query()` remains supported as a compatibility alias for existing apps.

Other canonical service helpers:

```ts
const indexes = vectors.list();
const records = await vectors.get('knowledge', ['doc_1', 'doc_2']);
const status = await vectors.status('knowledge');
```

`listIndexes()`, `fetch()`, and `stats()` remain supported.

## Filters

Filters are structured objects compiled to zvec's SQL-like scalar filter
syntax. Only configured scalar metadata fields, the built-in `id` field, and
the configured `text` field can be used. This prevents string injection and
catches unknown fields before the query reaches zvec.

Supported operators:

```ts
await vectors.search('knowledge', {
  vector,
  filter: {
    bucket: 'docs',
    id: { in: ['doc_1', 'doc_2'] },
    year: { gte: 2024, lt: 2027 },
    source: { in: ['manual', 'faq'] },
    active: { eq: true },
  },
});
```

Logical grouping:

```ts
filter: {
  $and: [
    { bucket: 'docs' },
    { $or: [{ source: 'manual' }, { source: 'faq' }] },
  ],
}
```

Supported field operators:

| Operator | Meaning |
| --- | --- |
| primitive value | equals |
| `eq` / `ne` | equal / not equal |
| `gt` / `gte` / `lt` / `lte` | numeric or lexicographic ranges |
| `in` / `notIn` | membership list |
| `exists` | null / not-null check |
| `like` | SQL-like string pattern |

Array/FTS-specific zvec operators are not exposed through Zero's first vector
filter API. Add a focused adapter extension later if an app needs them.

`id` filters use the document id you pass to `upsert()`. Internally, the zvec
adapter mirrors that id into an indexed scalar field so `search()`/`query()`
and `deleteWhere()` can use the same structured filter syntax. App metadata
cannot declare `_zero_id`; it is reserved for the adapter.

## Scopes

Use `scope()` to make bucket, tenant, room, or session isolation ergonomic:

```ts
const kb = vectors.scope('knowledge', {
  bucket: 'client-a',
});

await kb.upsert({
  id: 'client-a:chunk-1',
  vector,
  text: 'Scoped content',
});

const matches = await kb.search({
  vector: queryVector,
  filter: { source: 'manual' },
});
```

Scope behavior:

1. Reads through `search()`/`query()` and `deleteWhere()` are ANDed with the
   scope filter.
2. Upserts copy simple equality values such as `{ bucket: 'client-a' }` into
   record metadata.
3. Scoped fetches filter returned records in memory so an id guess cannot leak
   records from a different scope.

Keep scopes simple. If a scope uses complex ranges or OR groups, Zero can still
apply the filter to reads/deletes, but it cannot auto-stamp those values onto
writes.

## AI Bridge

Use the bridge when you want AI embedding plus vector storage in one small
helper:

```ts
import { createAIVectorBridge, getAI, getVectorStore } from '@zero/framework/server';

const ai = getAI();
const vectors = getVectorStore();
if (!ai || !vectors) throw new Error('AI and vectors must both be enabled.');

const bridge = createAIVectorBridge({
  ai,
  vectors,
  embeddingModel: 'embedding',
});

await bridge.embedAndUpsert('knowledge', {
  id: 'doc_1',
  text: 'Zero stores embeddings locally with zvec.',
  metadata: { bucket: 'docs' },
});

const matches = await bridge.embedAndQuery('knowledge', {
  text: 'How does Zero store vectors?',
  topK: 5,
  filter: { bucket: 'docs' },
});
```

Scoped bridge:

```ts
const docs = bridge.scope('knowledge', { bucket: 'docs' });

await docs.embedAndUpsert({
  id: 'chunk_1',
  text: 'Scoped bridge content.',
});
```

The bridge does not persist chat threads or create a gateway. It only calls
`ai.embed()` and forwards records/queries to the vector service.

## Workflows And Jobs

The vector plugin mounts before scheduler and workflow plugins, so jobs and
workflow activities can use it directly. Register this activity inside
`AppConfig.workflows.register(registry)`:

```ts
import { getAI, getVectorStore } from '@zero/framework/server';

registry.registerActivity({
  name: 'vector.index-document',
  version: '1',
  handler: async (ctx) => {
    ctx.signal?.throwIfAborted();
    const ai = getAI();
    const vectors = getVectorStore();
    if (!ai || !vectors) throw new Error('AI/vector services are not enabled.');
    const input = ctx.input as {
      id: string;
      text: string;
      metadata?: Record<string, unknown>;
    };

    const embedding = await ai.embed({
      model: 'embedding',
      value: input.text,
    });

    return vectors.upsert('knowledge', {
      id: input.id,
      vector: embedding.embedding,
      text: input.text,
      metadata: input.metadata,
    });
  },
});
```

The document ID makes this upsert safe to repeat. Keep that property for
external writes: crash recovery is at-least-once, and a handler receives the
same `ctx.idempotencyKey` across retries and recovery.

## Operational Notes

Zero's current adapter targets `@zvec/zvec@0.5.0`.

zvec is in-process and WAL-backed. That fits Zero's local embedded model: no
separate vector server is required. zvec supports multiple readers and
single-process exclusive writes, so deploy apps so one writer owns a collection
path at a time.

Vector values and text are not written to observability events. Vector
observability records index name, operation, count, duration, error count, and
filter field names only.

Run platform doctor after changing vector config:

```txt
bun run doctor -- --config ./zero.config.ts
```

Doctor warns about duplicate collection paths, paths that overlap platform file
storage or client build output, read-only indexes, unusually high dimensions,
missing/unusable `embedding` aliases when AI is enabled, and unindexed metadata
fields commonly used for scope filters such as `bucket`, `tenantId`, `ownerId`,
and `userId`.

## Environment

| Variable | Purpose |
| --- | --- |
| `ZERO_VECTOR_DATA_DIR` | Default vector collection base directory. |
| `ZERO_VECTOR_DEFAULT_DIMENSIONS` | Dimension used by `vector: true` and indexes that omit `dimensions`. |

AI provider keys still belong to the AI layer. Set `ZERO_AI_EMBEDDING_MODEL`
when you want the bridge to use a specific embedding alias by default.

## Related Docs

- [AI](./ai.md)
- [AI Providers](./ai-providers.md)
- [Workflows](./workflows.md)
- zvec docs: [Quickstart](https://zvec.org/en/docs/db/quickstart/) and
  [Conditional Filtering](https://zvec.org/en/docs/db/data-operations/query/filter/)
