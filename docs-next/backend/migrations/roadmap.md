---
id: zero.migrations.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: roadmap
maturity: supported
applies_to: ["2.6.0 with the legacy-state staging extension"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "66035d0dad75ea2276ce2f888499e2292b1ee995"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Migrations Roadmap

[Migrations index](./index.md) · [Documentation index](../../index.md)

## Known Direction

- [ ] Extend the [narrow offline legacy-state boundary](./legacy-state.md) with
  separately qualified source profiles and reviewed pending-work authority admission.
- [ ] Improve task/agent guidance around backups, plane selection, schema drift
  and deployment lifecycle, using existing primitives first.
- [ ] Integrate future database branching/preview tooling with explicit
  realm/version/checksum ownership.

These are user/product directions, not current migration flags or deadlines.
Keeping a critical app pinned to an older supported branch may be safer than an
unreviewed data conversion; the docs do not silently upgrade that app.

## Current Foundation

Ordered immutable registries, per-entry transactions, retained checksums,
append-only outcomes, installed schema history, safety gates and reviewable
planning already exist. Do not describe them as features awaiting implementation.

The documented working corrections reject asynchronous/generator handlers and
remove misleading generated no-op rollback. They retain existing committed
migration bodies/checksums; installed artifact qualification remains separate.

Identity-preserving offline staging for the known 1.3 combined schema now has a
public migration boundary. It does not authorize execution of old pending work
or remove the need for app-specific compatibility and cutover verification.

See [data planes](./data-planes.md), [registries](./registries.md),
[planning](./planning.md) and [Fabric roadmap](../fabric/roadmap.md).
