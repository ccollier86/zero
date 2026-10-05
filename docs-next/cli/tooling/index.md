---
id: zero.cli.tooling
type: index
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: tooling
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

# Scaffolding, Updates And Saved Releases

[CLI index](../index.md) · [Documentation index](../../index.md)

Use the package commands for portable apps. Use saved-release launchers when a
workstation should consume a selected **committed** Zero branch without packing
the developer's dirty checkout. Both paths produce package-mode applications;
source-copy customization is deliberate app ownership.

## Command Guides

| Task | Guide |
| --- | --- |
| Know what is installed and routed | [Dispatch](./dispatch.md) |
| Create a new application | [Create](./create.md) |
| Understand generated files/scripts | [Scaffolding](./scaffolding.md) |
| Copy selected reusable source | [Add](./add.md) and [source targets](./source-copy.md) |
| Update an existing package-mode application | [Update](./update.md) |
| Install workstation launchers | [Local install](./local-install.md) |
| Create from the saved package | [zero-new](./zero-new.md) |
| Update from the saved package | [zero-update](./zero-update.md) |
| Diagnose the app's installed version | [zero-doctor](./zero-doctor.md) |
| Select and inspect committed archives | [Releases](./releases.md) |
| Maintain the framework repository | [Maintainer scripts](./maintainer-scripts.md) |

[Configuration](./configuration.md) centralizes defaults and path settings.
[Roadmap](./roadmap.md) separates proposed discovery/configuration tools from
current commands.

## Composition And Philosophy

The inferred design is explicit ownership: an app keeps its source/data, Zero
updates its dependency, and saved packages identify a specific source commit.
An update is not scaffolding or source copying. Reversible install-state changes
cannot undo arbitrary user scripts or deployment side effects.

After creating/updating, use the [Doctor workflow](../doctor/usage.md), focused
application checks and the relevant [database migration](../../backend/migrations/index.md)
procedure only when required by the release contract.
