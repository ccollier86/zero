---
id: zero.cli
type: index
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: cli
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Zero Command-Line Tools

[Documentation index](../index.md)

Zero's command line creates package-mode applications, copies selected app-owned
source, updates framework dependencies and routes diagnostics/operational
commands. Commands run in Bun. A command name is not a permission boundary:
filesystem, scripts, imports, databases and downloads remain within the caller's
machine authority.

## Choose A Workflow

- [Tooling](./tooling/index.md): create, add, update and saved committed-package launchers.
- [Doctor](./doctor/index.md): configuration diagnostics, source rules and existing infrastructure inspection.
- [Migration CLI](../backend/migrations/cli.md): explicit system/application database targets and migration safeguards.

PDF browser installation is explained in [dispatch](./tooling/dispatch.md#operational-subcommands);
its service manual will own rendering policy when available. No command here
automatically converts an application's tenancy, copies its live database, or
deploys a server.

## Working Safely

Read the command's side effects before execution. Help is a discovery aid, not
permission to run a project script. Doctor imports trusted modules, update
`--check` runs application code, create `--install` can execute dependency
scripts, and migration commands can alter state. Use an inspected project and
explicit targets. Save framework provenance separately from app changes.
