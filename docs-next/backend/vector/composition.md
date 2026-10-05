---
id: zero.vector.composition
type: how-to
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: composition
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

# Compose A Vector Service

[Vector index](./index.md) · [Documentation index](../../index.md)

Managed createApp accepts vector configuration and assembles its app-owned
VectorService. Omit the feature when the app does not need local vector indexes.
The plugin lazily opens indexes; enabling it does not generate embeddings.

## Standalone Construction

```ts
import {
  resolveVectorConfig, VectorRegistry, VectorService,
} from '@zero/framework/vector';

const config = resolveVectorConfig({
  defaultIndex: 'documents',
  indexes: { documents: 3 },
}, {});
if (config === false) throw new Error('Vector configuration is disabled.');

export const vectors = new VectorService(new VectorRegistry({ config }));
// The owner must await vectors.dispose() at shutdown.
```

This example is server-only. A production embedding model must produce the
declared dimensions; three dimensions merely makes the shape clear.

createVectorPlugin decorates Elysia context with vectors and owns cleanup.
Its service/storeFactory/onServiceCreated options support deliberate trusted
composition. There are no public vector routes registered by default.

In corrected managed composition, an explicitly supplied runtime must have its
Observability dependency. The plugin captures that app emitter for newly created
service/registry/default adapter events; it does not fall back to another app's
ambient runtime. Startup cleanup ownership is registered before publication,
including a throwing onServiceCreated callback.

Standalone constructors retain compatibility defaults. VectorService's optional
VectorServiceOptions.emitCode, the registry/default adapter emitter, and the
plugin's emitCode allow explicit ownership. A prebuilt service or custom adapter
factory keeps its own telemetry contract; mounting it does not rewrite the object.

## Authority And Service Ownership

Do not hand a raw VectorService to an untrusted client or interpret its presence
as permission. In a multi-app process prefer explicit owning services;
getVectorStore is a process compatibility getter and is ambiguous with multiple
active providers.

The general authority-scoped request projection does not currently add vectors.
Application routes must derive current scope/permission from live Guardian
authority, compose a [scope](./scopes.md), and control result presentation.
Do not fabricate a session to obtain access.

See [configuration](./configuration.md), [adapters](./adapters.md),
[runtime composition](../runtime/composition.md), [operations](./operations.md)
and [errors](./errors.md).
