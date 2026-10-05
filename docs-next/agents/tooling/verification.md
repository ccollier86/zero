---
id: zero.agents.tooling.verification
type: how-to
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: verification
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["coding-agent application development", "installed-package discovery"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Verify A Task Without Broadening Its Scope

[Tooling index](./index.md) · [Documentation index](../../index.md)

Choose checks from the changed contract, not merely the largest script.
Typecheck representative public call shapes; reproduce the defect before the
focused fix; test success, failure and lifecycle/authority edges that matter.

## Trust And Effects

Inspect application scripts before running them. TypeScript plugins/module
evaluation, tests, hooks and build scripts can write output or start services.
Doctor imports trusted config/resources and may read existing SQLite files.
Migration applies/rollbacks alter a chosen DB. Provider calls can send data/cost
money. None is implicitly authorized by writing documentation.

Use synthetic config/environment and owned disposable source/data fixtures for
platform tests. Disable automatic env-file loading when running Bun synthetic
checks. Avoid live apps, DBs/storage/provider traffic unless placed in scope.
Do not keep raw secrets/private records/logs in evidence.

## Evidence Ladder

1. Source inspected: observed implementation/import/default shape.
2. Tests present: discovered tests, not necessarily run.
3. Focused checks passed: exact command/result against current source.
4. Committed reproducible verification: exact baseline plus relevant checks.
5. Package-qualified behavior: frozen archive/hash/public imports/docs/examples.

A dirty development suite is useful evidence, not proof that an old installed
release contains the correction. Record exact version/provenance and whether
checks used package or source. A clean Doctor report is not comprehensive
security/recovery/native-provider qualification.

## User-Facing Handoff

Lead with the implemented outcome and changed public contract, then concrete
focused results and any remaining in-scope work. Do not disguise defects as
documented limitations or imply deploy/publish without doing it.

[Doctor](../../cli/doctor/usage.md) owns diagnostic effects,
[updates](../../cli/tooling/update.md) owns managed rollback, and
[building conventions](./building-conventions.md) supplies integration fences.
