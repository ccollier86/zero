---
id: zero.vector.adapters
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: adapters
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

# Vector Registry And Index Adapters

[Vector index](./index.md) · [Documentation index](../../index.md)

VectorRegistry resolves names against configured indexes and lazily constructs
one VectorIndexStore per name. list/listIndexes do not open a native collection;
stats/query/write may.

## Adapter Contract

VectorIndexStore exposes config, upsert, query, fetch, delete, deleteWhere,
stats, optimize and dispose. All operations are asynchronous at the service
boundary. VectorRegistry's storeFactory supports synthetic tests and app-owned
adapter composition; it is not a browser provider selector.

VectorRegistryOptions.emitCode passes an owning emitter to the default
ZvecAdapter. A custom factory owns its own emission and storage implementation.
The managed plugin binds new default objects to the concrete app runtime rather
than looking up ambient Observability when a later operation runs.

The default ZvecAdapter creates/opens a local native collection using fixed
dimensions, vector fields, metric, index family and scalar metadata declarations.
Text and full JSON metadata are stored beside the dense embedding.

## Deployment And Lifecycle

Native module availability and collection compatibility must be qualified for
the deployment runtime/architecture. Typechecking an example and testing a fake
adapter do not prove a host can load zvec.

A service drains its admitted work before registry disposal. Raw adapter access
is privileged: another registry/process/native handle does not participate in
the same-service [write boundary](./scopes.md).

Partial native write/delete issues are operation results, not a new batch
transaction guarantee. An adapter must provide coherent fetch/write behavior
for scoped preflight; it must not independently bypass its owning service policy.

See [records](./records.md), [queries](./queries.md), [indexes](./indexes.md),
[operations](./operations.md) and [composition](./composition.md).
