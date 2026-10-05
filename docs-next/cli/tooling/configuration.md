---
id: zero.cli.tooling.configuration
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: configuration
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

# Tooling Options And Defaults

[Tooling index](./index.md) · [Documentation index](../../index.md)

These are command-invocation settings, not `AppConfig` or runtime credentials.
There is no universal `zero init-config` or `--config-dir` command.

## Package Commands

| Command | Accepted options | Default / interaction |
| --- | --- | --- |
| `zero create` / `create-zero` | exactly one target; `--name`, `--template`, `--zero`, `--force`, `--install`, `--local`, `--help/-h` | install/force/local false; shipped package-mode template; current framework-version dependency; local conflicts zero |
| `zero add` | items; `--target`, `--force`, `--dry-run`, `--list`, `--help/-h` | target current working directory; existing source skipped unless force |
| `zero update` | `--project`, `--local`, `--latest`, `--dry-run`, `--check`, `--skip-checks`, `--help/-h` | project current directory; registry unless local supplied; check false; latest conflicts local; check conflicts skip-checks |

Create value flags use separate arguments; update also supports `--project=value`
and `--local=value`. Do not assume every command accepts `--flag=value`.
See [create](./create.md), [add](./add.md) and [update](./update.md) for error and
side-effect behavior. Subsystems own [Doctor options](../doctor/configuration.md)
and [migration options](../../backend/migrations/configuration.md).

## Saved Launcher Installation

These values are read by `bun run install:local-tools`, not each app request.

| Environment name | Default |
| --- | --- |
| `DEV_DRIVE` | existing /Volumes/code-bank if present, otherwise no drive |
| `ZERO_LOCAL_BIN_DIR` | drive/tools/bin, otherwise user's .local/bin |
| `ZERO_LOCAL_TOOLS_DIR` | sibling lib/zero-stable under the bin parent |
| `ZERO_RELEASE_DIR` | drive/artifacts/zero-platform/release, otherwise repository .zero/releases |
| `ZERO_TOOLS_SCRATCH_DIR` | drive/tmp/scratch/zero-platform, otherwise repository .zero/scratch |

Installer saves a tools configuration containing resolved `repo`, `releases`
and `scratch` paths. Generated launchers set TMPDIR to that scratch path.
Setting these paths does not alter an application's DB or storage configuration.

Saved release metadata contains `schema: 1`, `source`, `branch`, `commit`,
`version`, `sha256`, and `createdAt`. It is provenance, not authentication.
See [installation](./local-install.md) and [release selection](./releases.md).

## Saved Command Differences

`zero-new` defaults target to `.` and installs dependencies unless
`--skip-install` / `--no-install` is supplied. `zero-update` accepts a positional
project or `--project` and always uses the saved package. Neither accepts a
framework-source override. `zero-release` defaults to local `main`; an exact
local branch may be passed. Only main automatically refreshes through managed
Git hooks. [Dispatch](./dispatch.md) explains package bins versus launchers.
