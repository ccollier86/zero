---
id: zero.vector.configuration
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: configuration
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

# Vector Configuration

[Vector index](./index.md) · [Documentation index](../../index.md)

vector is disabled when omitted or false. true creates a default index.
An object declares named indexes. Configuration is resolved before collections
open; it does not contact an embedding provider.

```ts
import { resolveVectorConfig } from '@zero/framework/vector';

export const vector = resolveVectorConfig({
  dataDir: './data/vector',
  defaultIndex: 'documents',
  defaultDimensions: 1536,
  indexes: {
    documents: {
      dimensions: 1536,
      metric: 'cosine',
      indexType: 'hnsw',
      metadata: { tenantId: 'string', published: 'boolean' },
    },
  },
}, {}); // Explicit environment map for this standalone example.
```

Managed app configuration supplies the object to createApp as vector; ordinary
resolution uses Bun.env. Never expose resolved filesystem paths to a browser.

## Defaults And Precedence

| Setting | Default / rule |
| --- | --- |
| dataDir | ZERO_VECTOR_DATA_DIR, then config.dataDir, then ./data/vector |
| defaultIndex | default; must exist in the resolved index map |
| defaultDimensions | Config, then ZERO_VECTOR_DEFAULT_DIMENSIONS, then 1536 |
| indexes | Default index if omitted/empty; number shorthand means dimensions |
| Per-index dimensions | Resolved defaultDimensions |
| path | dataDir plus sanitized index name |
| vectorField / textField / metadataField | embedding / text / _metadata |
| metric / indexType | cosine / hnsw |
| readOnly / enableMMAP | false / true |
| insertBatchSize | 250 |
| query | Empty object; per-call tuning overrides configured defaults |

Supported metrics are cosine/ip/l2; families are hnsw/flat/ivf/diskann.
Invalid metric/family values reject with VECTOR_CONFIG_INVALID rather than
silently selecting another implementation.

## Metadata Fields

Defaults promote namespace, bucket, tenantId, ownerId, userId, source, type,
version, createdAt and updatedAt as strings. Overrides merge with that catalog.
A field accepts string/number/boolean shorthand or {type,indexed,nullable,range}.
Those three boolean options default true. Field names and reserved collisions
are validated.

Declared metadata is native schema, not automatic Guardian or Fabric scoping.
See [indexes](./indexes.md), [scopes](./scopes.md), [tuning](./tuning.md),
[composition](./composition.md) and [operations](./operations.md).
