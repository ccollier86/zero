---
id: zero.ai.embeddings
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: single-batch-embeddings
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

# Single And Batch Embeddings

[Zero AI](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Use embeddings to convert authorized text into numeric vectors for search or
classification. AIService generates vectors; it does not automatically create a
Vector index, embed every schema column or authorize access to an organization's
records. Persist/query vectors through the appropriate app-scoped data service.

## Minimal Batch Function

Complete function receiving an already configured app-bound service:

```ts
import type { AIService } from '@zero/framework/ai';

export async function embedTexts(ai: AIService, texts: readonly string[], signal?: AbortSignal) {
  const result = await ai.embedMany({
    model: 'embedding',
    values: texts,
    maxParallelCalls: 4,
    abortSignal: signal,
  });
  return result.values.map((text, index) => ({
    text,
    vector: result.embeddings[index]!,
  }));
}
```

The caller must authorize/validate input and choose the index's dimensions/model.
The expected arrays preserve input order. Empty batches are rejected; empty
individual strings are still strings and do not share that array-empty rule.
Do not silently combine vectors from different models/dimensions in one index.

## API And Options

| Method | Input | Result |
| --- | --- | --- |
| embed(request) | AIEmbedRequest with value:string | Promise<AIEmbedResult>: detached embedding:number[], original value and optional usage. |
| embedMany(request) | AIEmbedManyRequest with values:readonly string[] | Promise<AIEmbedManyResult>: ordered values/embeddings, usage, warnings and SDK response/provider metadata. |

Both default to the embedding alias. Common options are model, maxRetries,
abortSignal, headers, providerOptions, metadata, runtimeContext, telemetry,
onStart and onEnd. Batch adds maxParallelCalls: default 4, allowed1–32.
The SDK batches according to the selected model's support; this limit bounds
concurrent provider calls after batching, not the number of values in a call.

These operations have no top-level timeout field. Use abortSignal with an
app-owned deadline when needed; do not assume the text-generation timeout
object is accepted by every AI method.

## Admission And Integrity

| Boundary | Value |
| --- | --- |
| Values per batch | Nonempty array, at most 10,000. |
| One value | String, at most 1 MiB UTF-8. |
| Aggregate values | At most 16 MiB UTF-8. |
| maxRetries when supplied | Integer0–10. |
| maxParallelCalls | Integer1–32, default 4. |

Inputs are copied before asynchronous work. Headers/providerOptions use the
common bounded snapshots in [generation controls](./generation-controls.md#bounded-mutable-inputs).

Zero validates raw provider responses as well as the SDK aggregate result:
the vector count matches input count, vectors are nonempty finite number arrays,
dimensions agree within a batch, and returned values match their original order.
Results detach mutable vectors and metadata so a later provider write cannot
replace an earlier operation's vector. Invalid provider integrity raises
AI_PROVIDER_RESPONSE_INVALID, not a plausible-looking incomplete batch.

A provider may omit measured usage; the installed SDK can represent unknown
tokens as NaN. Unknown usage is not a zero-token claim, and the standard
telemetry projection omits nonfinite counts rather than recording invented cost.

## Authority, Storage And Telemetry

The caller owns data access, provenance and vector persistence. Model/provider
credentials remain on the server. metadata is for safe correlation, not raw
document logging; SDK telemetry/callbacks are separate app-controlled boundaries.

The Vector integration has its own index/scoping contract. Enabling AI does not
turn a vector metadata filter into authorization or provision a tenant-owned
vector store automatically. For durable embedding tasks use a versioned
workflow/activity with app-owned idempotency around its authorized index writes.

## Verification And Related Guides

Use a provider double to test exact order, batching, abort/retries, wrong vector
count, inconsistent dimensions, NaN coordinates, empty vectors and mutation
detachment. Verify the index dimension matches the chosen model before writes.
A successful single embedding is not proof of batch fanout or remote account
capacity.

[Configuration](./configuration.md) chooses the embedding alias.
[Providers](./providers.md) explains capability versus model availability.
[Generation controls](./generation-controls.md) owns shared input snapshots.
Return to [Zero AI](./index.md) for durable task composition.
