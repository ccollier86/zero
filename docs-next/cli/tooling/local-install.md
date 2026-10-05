---
id: zero.cli.tooling.local-install
type: operations
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: local-install
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

# Install Saved-Package Workstation Launchers

[Tooling index](./index.md) · [Documentation index](../../index.md)

From an inspected framework checkout, `bun run install:local-tools` installs
`zero-new`, `zero-update`, `zero-doctor` and `zero-release`.
This is a **workstation/repository mutation**, not an application startup step.

Installer first packages committed main. If packaging fails, existing launchers
remain untouched. It copies a self-contained launcher runtime and saved tools
configuration to the selected library, writes executable command wrappers,
backs up prior managed commands, and may connect an old managed .bin command
location. Unrelated command files are rejected rather than overwritten.

[Path settings](./configuration.md#saved-launcher-installation) choose bin,
library, archive and scratch locations. The launcher does not depend on current
working-tree source after installation; it loads the saved committed archive.

## Git Hooks

When no custom core.hooksPath is configured, managed post-commit/post-merge
hooks refresh the saved package only on main. Existing nonmanaged hooks are
retained. When custom hook routing exists, installation prints integration
guidance rather than replacing it. Hooks are repository Git hooks, **not**
Codex/Claude/agent lifecycle hooks or Doctor automation.

A failed refresh leaves the previous stable archive selected. Explicitly run
`zero-release [branch]` after correcting the issue. A feature checkout alone
does not update the saved stable selection.

## Verification And Related Guides

Review installed paths and preserved command backups from installer output;
use [zero-release --status](./releases.md) to inspect selected version/source/hash.
Do not assume an externally installed command matches a new checkout until that
provenance is checked. [zero-new](./zero-new.md) and [zero-update](./zero-update.md)
describe use; [agent release hooks](../../agents/tooling/release-hooks.md)
describes automation scope.
