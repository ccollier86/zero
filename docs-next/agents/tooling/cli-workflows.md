---
id: zero.agents.tooling.cli-workflows
type: how-to
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: cli-workflows
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

# Choose The Right Tool For The Ownership Boundary

[Tooling index](./index.md) · [Documentation index](../../index.md)

| Intent | Existing tool | What it does not do |
| --- | --- | --- |
| New portable app | [create-zero / zero create](../../cli/tooling/create.md) | safely upgrade an existing app via force |
| New app from committed selected branch | [zero-new](../../cli/tooling/zero-new.md) | use live dirty framework source |
| Deliberately customized UI/hooks | [zero add](../../cli/tooling/add.md) | auto-merge copied source on later updates |
| Existing framework dependency | [zero update](../../cli/tooling/update.md) | regenerate config, convert tenancy or migrate DBs |
| Existing app from saved archive | [zero-update](../../cli/tooling/zero-update.md) | repack source or choose a remote branch |
| Diagnose installed app | [zero-doctor](../../cli/tooling/zero-doctor.md) | pure static/sandboxed inspection |
| Choose committed local package | [zero-release](../../cli/tooling/releases.md) | npm publication/deploy/Git push |
| Explicit schema/ledger changes | [zero migrate](../../backend/migrations/cli.md) | infer an app DB when --schema lacks --db |

Read exact command options before execution. Dry-run belongs to specific command
contracts, not a universal no-side-effect mode. --force creation and source
overwrites need resolved explicit targets. update --check opts into app scripts
beyond install-state rollback.

For a platform task, preserve app boundaries: changing Zero source is not
permission to patch consuming apps, their installed archives or live databases.
For an app task, do not mutate platform public APIs just to avoid using an
existing supported service.

[Onboarding](./onboarding.md), [configuration](./configuration.md) and
[verification](./verification.md) connect tool choice to evidence.
