---
id: zero.vector.overview
type: index
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: overview
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

# Local Vector Storage

[Backend index](../index.md) · [Documentation index](../../index.md)

Zero's vector service stores named local vector indexes with chunk text and
app-owned metadata. It separates embedding generation from persistence:
AI supplies vectors, VectorService performs operations, and an index adapter
owns its native collection.

This is a server-only service. It does not currently install a browser API,
organization self-service provisioning, Guardian authorization, Fabric SQL
realms or realtime result hooks. See the [roadmap](./roadmap.md) for those
separately proposed capabilities.

## Feature Guides

- [Composition](./composition.md): managed settings and standalone Elysia wiring.
- [Adapters](./adapters.md): registry, lazy stores and native deployment boundary.
- [Configuration](./configuration.md): exact defaults and environment precedence.
- [Indexes](./indexes.md): dimensions, metric and promoted metadata schema.
- [Records](./records.md): upsert/fetch identity and partial operation results.
- [Queries](./queries.md): similarity or scalar-only search and output selection.
- [Filters](./filters.md): safe structured expressions rather than raw SQL.
- [Scopes](./scopes.md): required metadata, scope integrity and live app authority.
- [Deletes](./deletes.md): ID/filter deletion and scoped restrictions.
- [Tuning](./tuning.md): family-specific query parameters.
- [Operations](./operations.md): status, optimization, capacity and disposal.
- [AI integration](./ai-integration.md): text embeddings and multi-record composition.
- [Errors](./errors.md): domain codes, observability and safe public presentation.
- [Roadmap](./roadmap.md): future organization-owned stores and related ideas.

## Integration Philosophy

An index's embedding shape is an explicit persistent contract, not a property
that changes whenever an AI model setting changes. A metadata scope is a
narrowing rule, not authentication. Keep native paths, provider credentials and
privileged service handles inside server code.

Compose with [AI](../ai/index.md), [Guardian](../guardian/index.md) and
[request services](../runtime/server-services.md), understanding their distinct
authority boundaries.
