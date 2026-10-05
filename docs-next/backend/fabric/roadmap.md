---
id: zero.fabric.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: roadmap
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Fabric Roadmap

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Known Product Directions

- [ ] Independent optional logs, metrics and audit storage planes with explicit
  retention and their own reusable administration UI.
- [ ] Database branching and preview/deployment lifecycle tooling.
- [ ] More operational capacity/recovery/identity diagnostics driven by measured
  workloads, without exposing physical paths or weakening authority.
- [ ] Intentional legacy app migration assistance where a safe conversion can be
  demonstrated; no universal automatic splitter is promised today.

These are recorded user directions, not scheduled features or supported APIs.
Hybrid file/hot placement is already implemented; it belongs in the
[current placement guide](./placement.md), not on a future-only checklist.

## Deliberate Boundary

Fabric does not fork SQLite for concurrent same-file writes. Independent files
can execute concurrently and file-backed WAL readers can overlap a writer.
There is no distributed consensus/replication guarantee across independent Zero
instances sharing a root.

Any future triggers/functions remain adjacent to the admitted realm/schema and
must preserve ReactiveDB tracking and live authority. The current
[database automation system](../database-automations/index.md) already owns
declared functions/AFTER triggers and durable actions; do not present those as
missing groundwork.

## Release Qualification

This documentation set is a source-validated draft against the declared
baseline plus explicitly labeled working corrections. Source tests and example
typechecks are not installed-package or production deployment certification.
An exact corrected commit/artifact, supported public imports and independent
end-to-end fixtures remain qualification gates.

See [actor launch](./actors.md), [identity projection](./identity-projection.md)
and [runtime lifecycle](../runtime/lifecycle.md) for today's contract.
