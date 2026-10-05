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
applies_to: ["2.1.1 baseline with unreleased handler/planning corrections"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Migrations Roadmap

[Migrations index](./index.md) · [Documentation index](../../index.md)

## Known Direction

- [ ] Consider narrowly scoped, demonstrably safe conversion assistance for
  old combined-layout applications.
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

See [data planes](./data-planes.md), [registries](./registries.md),
[planning](./planning.md) and [Fabric roadmap](../fabric/roadmap.md).
