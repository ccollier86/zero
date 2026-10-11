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
| lexical | false; opt in to the native full-text text index and hybrid retrieval |
| insertBatchSize | 250 |
| query | Empty object; per-call tuning overrides configured defaults |

Supported metrics are cosine/ip/l2; families are hnsw/flat/ivf/diskann.
Invalid metric/family values reject with VECTOR_CONFIG_INVALID rather than
silently selecting another implementation.

## Optional Full-Text Index

`lexical: true` adds a native full-text index to the configured text field. On an
existing writable collection, explicit opt-in admits only a missing full-text
index. It does not drop or rebuild another index. A conflicting text index or a
read-only collection without the required full-text index fails admission.
This native collection change is separate from relational app/SYSTEM migrations.

See [queries](./queries.md) for lexical/hybrid inputs and
[visualizations](./visualizations.md) for the optional managed progress feature.

## Metadata Fields

Defaults promote namespace, bucket, tenantId, ownerId, userId, source, type,
version, createdAt and updatedAt as strings. Overrides merge with that catalog.
A field accepts string/number/boolean shorthand or {type,indexed,nullable,range}.
Those three boolean options default true. Field names and reserved collisions
are validated.

Declared metadata is native schema, not automatic Guardian or Fabric scoping.
See [indexes](./indexes.md), [scopes](./scopes.md), [tuning](./tuning.md),
[composition](./composition.md) and [operations](./operations.md).
