---
id: zero.torrent.graph-ir
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: graph-ir
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Canonical Workflow Graph IR

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

WorkflowGraphIR is the JSON-safe shared format for code DSL, database/API
definitions and visual/agent authoring. schemaVersion is currently 1, independent
of a definition publication version or activity version.

## Shape And Admission

A graph has schemaVersion, entry, nodes and edges. Node kinds are activity,
wait, choice, parallel, join and each. Stable IDs identify persistence/output
references. Edges have id/from/to and optional branch/order/condition/default.
Choice conditions are legal only on choice edges.

A compiler creates deterministic @zero/ control IDs; user IDs cannot occupy
that prefix. Graph validation checks the bounded shape, referenced nodes,
dependency/entry reachability, legal control joins and expression/schema data.
Do not forge compiler-owned IDs as editor-generated application IDs.

validateWorkflowGraphIR validates a candidate; canonicalizeWorkflowGraphIR
detaches/canonicalizes it; compileFlow produces it from the DSL.
assertWorkflowJsonValue rejects non-data input. No runtime callbacks,
closures, custom prototypes, accessors, cyclic objects or source code are
accepted as an executable node.

## Bounds

WORKFLOW_GRAPH_LIMITS is a public reference constant, not an app setting:

| Limit | Value |
| --- | --- |
| Nodes / edges | 1,000 / 4,000 |
| Graph nesting depth / parallel branches | 16 / 64 |
| each concurrency / request delivery activities | 100 / 32 |
| Interaction rejection ceiling | 1,000 |
| ID / label / event length | 128 / 240 / 200 characters |
| Activity name / version / description | 256 / 128 / 2,000 characters |
| Capability count / capability length | 64 / 128 |
| Expression depth / nodes | 32 / 512 |
| Expression path segments / segment length | 64 / 256 |
| JSON depth / members / string length | 128 / 100,000 / 1,000,000 |
| JSON total character budget | 2,000,000 |
| Definition envelope bytes | 2 MiB |

Runtime values and event/memory budgets are separate; a graph within these
limits is not an unlimited run. Current each admission requires exactly one
activity node and no body edges. The DSL's flow-shaped body parameter does not
imply arbitrary nested waits/parallel workflows are supported per item.

## Schemas And Fingerprints

normalizeWorkflowSchemaSnapshot converts TypeBox/JSON Schema into durable
data; rehydrateWorkflowSchema restores runtime TypeBox kind metadata;
validateWorkflowSchemaValue checks a value. Executable transforms and unsafe
symbol/data properties are rejected. Schema snapshots are part of immutable
definition content, not a mutable live pointer.

stableWorkflowStringify and fingerprintWorkflowDefinitionContent canonicalize
definition graph/schema/access/format. Fingerprints are not hashes of activity
handler implementations; version code deliberately.

## Integration And Verification

A database editor should produce graph data and publish through the authorized
definition API, not write private definition tables. Managed compilation pins
databaseCallable activities. A standalone IR validator alone does not prove
live role/tenant authority or code availability.

Related: [definitions](./definitions.md), [activities](./activities.md),
[expressions](./expressions.md), [control flow](./control-flow.md).
