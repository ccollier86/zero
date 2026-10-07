---
id: zero.cli.tooling.update
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: update
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

# Update Zero Without Regenerating The App

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero update` manages the framework dependency, the project's single Bun
lockfile, installed framework state and, in local mode, the managed private
framework archive. It does **not** rewrite app source/config/env, storage,
databases, tenant data or choose/run migrations.

```sh
# Inspect the intended app first:
bunx --bun zero update --project ./example-app --dry-run
# Registry update respecting the configured dependency:
bunx --bun zero update --project ./example-app
```

`--latest` requests latest registry resolution. `--local <framework-dir>`
packs a trusted live checkout; this includes eligible uncommitted files.
Use [zero-update](./zero-update.md) for a saved committed archive instead.

## Preconditions And Installation

Project must exist, have a regular package.json with one framework dependency,
and exactly one of bun.lock/bun.lockb. Local archives require text bun.lock and
the managed `file:./.zero/framework/zero-framework.tgz` binding; convert an old
binary lock deliberately before local update.

Updater acquires a per-project update lock, snapshots managed install state,
stages a unique local archive reference to refresh transitive metadata, restores
the canonical manifest/archive binding, and verifies installed framework files.
Installation uses ignore-scripts by default. Local checksum/lock metadata must
agree; a stale archive hash is not accepted as a successful refresh.

For an archive-based workspace app, a root
`overrides['@zero/framework']` entry may match the same managed archive as the
root dependency. The updater stages both references consistently and validates
their exact lockfile locations before restoring the canonical archive binding.
Workspace peer declarations and unrelated overrides/pins remain unchanged;
root package.json is restored byte-for-byte, including formatting. A conflicting
framework override fails preflight rather than silently selecting a different
source. Staged/canonical install or verification failure uses the same rollback
boundary for the prior manifest, lock, archive and installed framework.

Dry-run inspects targets/dependency state but does not pack, install or mutate
them. It cannot predict every future install failure or report a registry
version as if it were already installed.

## Checks And Failure Recovery

`--check` explicitly executes existing app-owned typecheck/Doctor scripts
after install. Those scripts can have arbitrary effects outside updater
rollback; inspect them before opting in. `--skip-checks` spells the safe
default and conflicts with check. Local conflicts latest.

Managed failure triggers a reversible install-state rollback. If restoration
fails, the recovery snapshot is preserved and reported; do not delete it before
inspection. Rollback is not a backup of all app data or user scripts.
Human errors include rollback status, not a guarantee that arbitrary filesystem
races can be repaired.

### 2.6 Candidate: Local Archive Rollback Binding

The current 2.6.0 working-source qualification also checks a subsequent ordinary
frozen install after rollback, with populated `node_modules` and package cache
left in place. This is separate from the historical 2.1.1 header qualification.

For a local/saved archive, rollback restores the original manifest, archive and
lock, then runs a targeted, script-free
`bun update @zero/framework --frozen-lockfile --force --no-cache --ignore-scripts --no-progress`
to rebind Bun's extracted canonical archive. It restores and verifies the exact
snapshot bytes afterward, and restores the captured installed framework.
Registry rollback continues to use a frozen `bun install`.

On the qualified Bun 1.3.14 baseline, extracted tarball cache names depend on
the locator, not archive integrity. Restoring the old lock alone does not
replace a cached new payload. See the [pinned Bun cache implementation](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/install/PackageManager/PackageManagerDirectories.zig#L321-L329).
This repair does not claim general isolation for concurrent local-archive
installs sharing Bun's global cache. Synthetic parallel qualification fixtures
use their own retained extraction cache; this is not an instruction to clear
an existing app's lock, installed packages or cache before updating.

## Related Guides And Next Steps

[Saved updates](./zero-update.md) for branch provenance,
[Doctor](../doctor/index.md) for scoped diagnosis and
[migration data planes](../../backend/migrations/data-planes.md) when a release
actually requires schema changes. Source-copied UI remains app-owned.
