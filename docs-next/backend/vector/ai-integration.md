---
id: zero.vector.ai-integration
type: how-to
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: ai-integration
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

# Embed Text And Store Or Search It

[Vector index](./index.md) · [Documentation index](../../index.md)

createAIVectorBridge composes an AIService and VectorService. It keeps provider
credentials/model execution in Zero AI and native persistence in the vector
service.

```ts
import type { AIService } from '@zero/framework/ai';
import { createAIVectorBridge } from '@zero/framework/vector';
import type { VectorService } from '@zero/framework/vector';

export function knowledge(ai: AIService, vectors: VectorService) {
  return createAIVectorBridge({ ai, vectors, embeddingModel: 'configured-model-alias' });
}
```

The alias must name an admitted embedding model. Its output must match the
configured index dimensions.

## Bridge Methods

embedText accepts text plus optional AI embedding controls. embedAndUpsert
embeds a record's text before storage. embedAndQuery embeds query text before
similarity search. scope(index,filter) returns the same operations constrained
by [required vector metadata](./scopes.md).

embedAndUpsertMany currently loops through ai.embed for each input, builds records
and then calls vector upsert. It is not the provider-batched AI embedMany API,
nor a promised parallel embedding pipeline. Provider calls can incur cost before
a later write is rejected; a vector failure does not refund embeddings.

## Metadata And Privacy

Records may select their own model/providerOptions; the bridge default is used
otherwise. The orchestration adds index/recordId or operation metadata to AI
calls. Such identifiers are not universally redacted automatically—apply app
observability/privacy policy before attaching sensitive identifiers.

Chunking, relational metadata, access policy, reindexing and retention remain
explicit application responsibilities. No automatic ReactiveDB subscription or
Fabric organization provisioning is installed.

See [AI embeddings](../ai/index.md), [indexes](./indexes.md),
[records](./records.md), [queries](./queries.md) and [errors](./errors.md).
