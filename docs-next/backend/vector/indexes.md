---
id: zero.vector.indexes
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: indexes
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

# Index Shape And Metadata Promotion

[Vector index](./index.md) · [Documentation index](../../index.md)

An index has one configured dense vector dimension. Values must match that
shape and be finite numbers. A change of embedding model must deliberately
preserve dimensions or use a new/rebuilt index; no automatic migration happens
because the AI default changes.

## Persistent Shape

vectorField names the embedding; textField stores chunk text; metadataField
stores full JSON metadata. Promoted scalar metadata fields support native
filtering with declared string/number/boolean types. Full arbitrary app metadata
does not become an indexed scalar merely by being present on a record.

Names are checked against vector/text/metadata/internal ID fields. Configuration
rejects duplicate/reserved collisions. readOnly rejects provider writes;
enableMMAP selects local collection I/O behavior, not Fabric RAM mode.

## Metric And Family

cosine, ip and l2 select native distance semantics. hnsw, flat, ivf and diskann
select native index families. Returned scores remain provider results; do not
invent one universal probability interpretation.

Family selection and tuning should be measured with representative dimensions,
data volume and recall requirements. Native support and existing collection
compatibility require deployment qualification.

See [configuration](./configuration.md), [records](./records.md),
[filters](./filters.md), [tuning](./tuning.md) and [AI integration](./ai-integration.md).
