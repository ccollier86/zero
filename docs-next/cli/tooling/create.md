---
id: zero.cli.tooling.create
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: create
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

# Create A Package-Mode Application

[Tooling index](./index.md) · [Documentation index](../../index.md)

Creation writes a new app-owned project using public package imports. Choose a
new explicit target; inspect it before using `--force`.

```sh
bunx --bun --package @zero/framework create-zero ./example-app --name example-app
cd example-app
bun install
bun run typecheck
```

The CLI does **not** install dependencies by default. Passing `--install`
runs `bun install` inside the staged app; dependency installation scripts may
execute. These commands are operational examples, not executed evidence.

## Source And Template Selection

Default template is the shipped package-mode starter. `--template <dir>`
selects an inspected complete template directory. `--zero <specifier>`
selects the generated framework dependency; otherwise the framework package
version is used. `--local` packs eligible files from the running framework
checkout into the app's private archive dependency. It cannot be combined with
`--zero`. For committed-only provenance use [zero-new](./zero-new.md), not local.

Strict parsing rejects unknown/duplicate options, missing value arguments and
multiple targets. Help accepts at most one target and performs no creation.

## Staging And Replacement

Template copying, generated manifests/configuration and optional preparation
finish in a sibling staging directory before target commit. Unsafe broad paths,
overlaps and symlink trees are rejected by scaffold safety. A nonempty existing
target is rejected unless `--force` explicitly permits replacement.
Force is not an incremental update: existing app-owned content may be replaced.
Do not use it to repair an established application.

Failed preparation leaves the target unswapped and retires owned staging.
Install failure returns its child exit code; other failures return one. Success
prints target/name/setup guidance. Read [generated files](./scaffolding.md)
before first startup: starting the app can initialize database state.

## Related Guides And Next Steps

[Configuration](./configuration.md#package-commands) for exact flags,
[update](./update.md) for existing apps, [Doctor trust](../doctor/config-loading.md)
before diagnostics, and [saved releases](./releases.md) for branch-aware creation.
