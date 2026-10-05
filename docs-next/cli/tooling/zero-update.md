---
id: zero.cli.tooling.zero-update
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: zero-update
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

# Update From A Saved Committed Package

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero-update` invokes the saved package's updater using the selected archive.
It does not repack local source or regenerate the app.

```sh
zero-release --status
zero-update ./example-app --dry-run
# After reviewing the selected archive and app:
zero-update ./example-app
```

A project may be positional or `--project <dir>`; absent project uses current
directory. `--dry-run`, `--check` and the updater's compatible options apply.
`--local` and `--latest` are rejected because they would defeat saved-package
provenance. After a successful mutating update, launcher writes the selected
release metadata to the app's `zero-release.json`; dry-run does not.

[Updater preconditions/rollback](./update.md) remain authoritative. This workflow
requires a managed archive dependency and text Bun lockfile. Check opts into
trusted app scripts; no DB migration, tenant conversion or data copying is
implicitly performed.

A failure to inspect the archive or update returns a nonzero result; preserve
reported recovery backups. Compare installed package version/hash/provenance
with [releases](./releases.md), then perform focused application verification.
Using main versus release/1.3 is a release selection choice, not a runtime mode.
