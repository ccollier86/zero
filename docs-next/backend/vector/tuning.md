---
id: zero.vector.tuning
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: tuning
maturity: supported
applies_to: ["2.10.5 source/local release; native-platform coverage is separately qualified"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.10.5"
  commit: "175260f72132d6920dd00d960a267196b7f8b13f"
  snapshot: clean
  date: "2026-11-14"
  evidence_level: source-observed
---

# Query-Time Index Tuning

[Vector index](./index.md) · [Documentation index](../../index.md)

Each index may declare query defaults; per-call query values override them.
The selected native index family determines which options are passed through.

| Family | Applicable options |
| --- | --- |
| hnsw | ef, linear, radius |
| ivf | nprobe, linear, radius |
| diskann | listSize, linear, radius |
| flat | No family-specific query parameter object |

ef controls the HNSW candidate list; nprobe controls IVF probes; listSize controls
DiskANN candidate breadth. These are native query knobs, not tenant quotas,
embedding batching or a guaranteed latency/recall target.

## Optional Values At The Native Boundary

After merging index defaults and per-call tuning, Zero forwards only defined
options for the selected family. An omitted or `undefined` option is absent
from the native parameter object; it is not sent as a present undefined value.
This distinction matters because the installed native parser rejects that
present-but-undefined shape rather than applying its defaults.

Explicit `linear: false` and `radius: 0` are retained, not discarded by a
truthiness check. The native API defines radius zero as disabling range
filtering. Native defaults still own unspecified candidate/probe counts; Zero
does not force a linear scan or substitute a global radius to make queries pass.
Invalid supplied values are not silently dropped and still fail through Zero's
sanitized `VECTOR_OPERATION_FAILED` boundary.

```ts
await zero.vector.query('documents', {
  vector: embedding,
  topK: 20,
  query: { ef: 128 }, // HNSW: radius and linear may remain omitted.
});
```

Zero 2.10.4 could construct present undefined properties for HNSW, IVF and
DiskANN. Update Zero normally to obtain this correction; no relational migration
or vector reindex is needed. An existing explicit
`query: { ef: 128, linear: false, radius: 0 }` remains valid. Do not remove an
application's deliberately chosen tuning or structured access filters as an
upgrade workaround.

The native regression exercises HNSW's installed parser and engine with
1,024-dimensional synthetic vectors, hybrid search and reopen. Parameter-shape
regressions cover IVF and DiskANN too; those tests do not by themselves certify
their native engine/platform availability or establish recall/performance claims.

## Use Deliberately

Start with the configured family and a representative dataset. Measure useful
result recall, latency and memory under the actual native runtime. Do not select
a tuning option merely because another index family uses it.

Scalar-only queries do not construct vector-family query parameters. topK,
minScore, filters and output selection remain their [own query controls](./queries.md).

A model dimension change is an index-shape decision, not a tuning override.
Read-only/MMAP/batch size belong to startup [configuration](./configuration.md).

See [indexes](./indexes.md), [adapters](./adapters.md),
[operations](./operations.md) and [AI integration](./ai-integration.md).
