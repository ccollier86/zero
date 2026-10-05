---
id: zero.vector.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: roadmap
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

# Vector Roadmap

[Vector index](./index.md) · [Documentation index](../../index.md)

## Known Future Plans

- [ ] Investigate organization-owned vector stores and configurable provisioning.
- [ ] Design chunks plus metadata composition with relational app data.
- [ ] Evaluate optional GraphQL/vector integration.
- [ ] Consider provider-batched embedding orchestration and explicit reindexing.
- [ ] Evaluate a permission-adaptive vector management UI and client surface.

These are requested investigations/ideas, not current exported endpoints,
Fabric-backed vector realms or automatic Guardian scope guarantees.

## Guardrails

Preserve the separation between AI provider calls, native persistent shape,
application authorization and result presentation. New provisioning should
follow the live authority and resource lifecycle patterns already used by
[Storage](../storage/index.md) and [Data Studio](../data-studio/index.md).

See [current features](./index.md), [configuration](./configuration.md),
[scopes](./scopes.md) and [AI integration](./ai-integration.md).
