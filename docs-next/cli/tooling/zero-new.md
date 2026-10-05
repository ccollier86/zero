---
id: zero.cli.tooling.zero-new
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: zero-new
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

# Create From A Saved Committed Package

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero-new` requires the [local launchers](./local-install.md) and a selected,
checksum-validated saved package. Unlike `create-zero --local`, it never packs
the live working tree.

```sh
zero-release --status
zero-new ./example-app --name example-app --skip-install
```

Target defaults to `.`; dependency installation defaults **on**.
`--skip-install` / `--no-install` disables it. `--install` is accepted as the
explicit default. Name, force and help pass through the strict create parser.
`--local`, `--zero` and `--template` overrides are rejected, including inline
forms: saved archive and template are the command's invariant.

The launcher extracts the validated saved package to owned scratch space,
scaffolds from its template, copies its archive to
`.zero/framework/zero-framework.tgz`, records `zero-release.json`, and installs
when requested. The app dependency is the canonical relative archive binding.
Scratch extraction is retired after use; app files/provenance remain.

All [create staging/force safety](./create.md#staging-and-replacement) still
applies. Install runs Bun dependency scripts; authorize those effects. Missing
stable metadata or a bad checksum fails with no working-tree fallback.
Check [release identity](./releases.md) before starting the new app.
