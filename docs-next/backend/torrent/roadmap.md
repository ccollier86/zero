---
id: zero.torrent.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: roadmap
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

# Torrent Roadmap

[Torrent](./index.md) · [Documentation index](../../index.md)

This separates source capabilities from future direction, without release dates
or unsupported public API promises.

## Existing Foundation

- [x] Legacy plus simple graph DSL and JSON-safe canonical IR.
- [x] Immutable code/database definitions, drafts and activity opt-in.
- [x] Choices, parallel joins and bounded single-activity each fan-out.
- [x] Durable waits, early inbox and request/response interactions.
- [x] Private attempt-local scratch memory committed with successful steps.
- [x] Retry/deadline wake, pause/cancel and awaited shutdown.
- [x] Guardian actor/system seals, live revocation and owner fencing.
- [x] Read-only payload-safe live progress, topology and hooks.
- [x] AI durable-agent and database automation integration.

These source-observed capabilities are not artifact qualification.
The scratch deletion correction remains reviewed development evidence until
root promotes a committed baseline.

## Approved Product Direction

- [ ] Exercise these surfaces in an app-owned n8n/Activepieces-style editor and
  automation product.
- [ ] Continue simple authoring and production/agent-quality documentation.
- [ ] Prove server execution/live visualization/exact response correlation
  across realistic organizational/Fabric boundaries.

The engine is general-purpose, not tied only to AI, browsers or one transport.
A frontend editor product/node library is separate from core backend contracts.

## Future Design Work

Arbitrary nested each bodies, additional connector/node libraries, visual
designer packages and richer operator tooling require separate design.
The current each intentionally admits one activity, despite flow-shaped input.

Automatic billing, unrestricted database-stored handler code and exactly-once
external networks are not claimed. Preserve the
[activity trust boundary](./activities.md) as future plugins/configuration grow.
