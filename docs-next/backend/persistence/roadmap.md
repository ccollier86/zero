---
id: zero.persistence.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: roadmap
maturity: planned
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Persistence Roadmap

[Persistence index](./index.md) · [Documentation index](../../index.md)

Known user directions include separately configurable logs, metrics
and audit data planes using Fabric, with later operational viewers. They are
not automatically enabled databases or shipped dashboards.

- [ ] Define optional operational plane ownership/retention and safe sink adapters.
- [ ] Improve data-plane diagnostics without leaking paths/tenant data to clients.
- [ ] Explore database branching/development deployment lifecycle.
- [ ] Evaluate other storage backends only with explicit durability/compatibility design.

File/hot/hybrid placement already exists in Fabric; it must not be described as
future-only. Standalone hot snapshotting and Fabric acknowledgement guarantees
remain deliberately distinct.

## Related Guides And Next Steps

- [Modes](./modes.md) is the current storage contract.
- [Lifecycle](./lifecycle.md) owns today's durability boundary.
- [Data planes](../../concepts/data-planes.md) introduces explicit operational ownership.
