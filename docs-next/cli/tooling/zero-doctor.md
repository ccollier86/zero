---
id: zero.cli.tooling.zero-doctor
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: zero-doctor
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

# Run Doctor From The Application's Installed Package

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero-doctor` locates `node_modules/@zero/framework/src/doctor/run.ts` under
the current working directory and runs that installed entry with Bun. It does
not use the framework checkout's Doctor or replace it with the selected saved
archive.

```sh
cd example-app
zero-doctor --config ./zero.config.ts --strict --json
```

Run only in an inspected application after dependency installation. The wrapper
fails when the installed entry is missing. It forwards Doctor options and child
failure; `--help/-h` is handled by launcher help without executing diagnostics.

The underlying [Doctor CLI](../doctor/usage.md) imports config/resource modules,
uses inherited environment and can inspect existing SQLite state. It is not a
read-only source-only sandbox merely because it was launched globally. Avoid
unexpected environment-file loading during synthetic checks.

Use this when validating the **installed** app version; use [saved release
status](./releases.md) to check which archive a future update will consume.
Those two versions can differ until update completes.
