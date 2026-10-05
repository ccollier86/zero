---
id: zero.sync.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Sync Roadmap

[Sync index](./index.md) · [Documentation index](../../index.md)

## Established Direction

Keep ReactiveDB's fast tracked-change delivery while preserving explicit
authority, independent plane cursors and bounded transport behavior.
Current [system behavior](./index.md) must not be confused with future proposals.

## Known Future Ideas

- [ ] Evaluate an external messaging/event bus for participation across services.
  The current in-process ephemeral store is not that bus.
- [ ] Broaden deployment/real-socket qualification across managed mode
  combinations and multiple runtimes.
- [ ] Improve operational diagnostics while avoiding payload/credential disclosure.

Database actions and correlated workflow resume belong to
[database automations](../database-automations/index.md), not a future-only
promise in Sync. They are already separately inventoried and documented.
No schedule or new distributed delivery guarantee is implied by this roadmap.

See [configuration](./configuration.md), [lifecycle](./lifecycle.md) and
[Fabric realtime](../fabric/realtime.md).
