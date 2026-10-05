---
id: zero.cli.tooling.dispatch
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: dispatch
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

# Command Dispatch And Trust Boundaries

[Tooling index](./index.md) · [Documentation index](../../index.md)

The package declares two executable bins: `zero` and `create-zero`.
`zero` dispatches six subcommands: `add`, `create`, `doctor`, `migrate`,
`pdf`, and `update`. The four `zero-*` workstation launchers are installed
separately; they are not npm bins.

```sh
bunx --bun --package @zero/framework zero --help
# Within an app after installation:
bunx --bun zero --help
```

These help examples describe intent; no command was executed for this manual.
`zero --help` / `-h` exits zero; no command prints usage and exits one.
An unknown command prints an error/usage and exits one.

## Operational Subcommands

- `zero doctor`: imports trusted configuration/resources and can inspect existing SQLite files. Follow [Doctor](../doctor/index.md).
- `zero migrate`: system migrations and explicitly targeted app-schema inspection. Follow the [migration CLI](../../backend/migrations/cli.md).
- `zero pdf` (no argument defaults to `status`): reports managed Chromium's executable path; status exits zero when installed and one when absent.
- `zero pdf install`: downloads the pinned browser through the PDF installer.
- `zero pdf install --with-deps`: additionally asks Playwright for Linux OS dependencies; authorize host/package-manager changes separately.
- `zero pdf help`, `--help`, or `-h`: print usage without installing.

The dispatcher owns routing only. Domain parsing, console output, operations and
error exit codes belong to each command. Human CLI errors are not API response
objects. Imported config/modules and inherited process environment remain
trusted execution inputs.

## Related Guides And Next Steps

[Create](./create.md) for new files, [update](./update.md) for dependency-only
changes, [saved releases](./releases.md) for exact branch provenance, and
[configuration](./configuration.md) for invocation defaults.
