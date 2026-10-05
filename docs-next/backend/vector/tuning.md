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
