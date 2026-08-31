# Project Storage Protocol

## Agent Quick Brief

Code has been moved to the external development volume:

```text
/Volumes/code-bank/code
```

`/Users/catalystlabs/projects` is a compatibility symlink to that same tree.
Agents may work from `~/projects/<project>` so existing Codex/history paths keep
working, but `pwd -P` should resolve to `/Volumes/code-bank/code/<project>`.

This machine previously ran out of internal disk space because dependency trees,
package caches, compiler caches, build outputs, release artifacts, and Docker
state accumulated without a shared policy. The rule now is simple:

- source stays in the project;
- rebuildable dependencies and caches are disposable and must use external roots;
- build outputs and release artifacts must have known external locations;
- runtime data is never deleted by generic cleanup.

Canonical policy paths:

```text
/Volumes/code-bank/policies/project-storage-protocol.md
/Volumes/code-bank/policies/agent-storage-handoff.md
/Volumes/code-bank/policies/agent-start-prompts.md
/Volumes/code-bank/policies/new-project-agent-brief.md
/Volumes/code-bank/policies/existing-project-migration-brief.md
/Volumes/code-bank/policies/build-cache-artifact-layout.md
/Volumes/code-bank/code/AGENTS.md
```

## Storage Classes

Every project file belongs to one class:

```text
source        code, configs, docs, lock files
deps          node_modules, .venv, installed package trees
build-cache   Rust target, Gradle/CMake/compiler outputs, incremental build state
releases      app bundles, installers, APK/AAB, DMG/EXE/AppImage, release zips
artifacts     non-release generated deliverables, reports, preserved diagnostics
runtime-data  databases, models, ROMs, Docker volumes, app libraries
logs          test logs, crash reports, diagnostics
scratch       temporary experiments and throwaway generated files
```

Source is durable. Everything else gets a known location, a budget, and a
retention policy.

## External Drive Layout

```text
/Volumes/code-bank/
  code/
    <project>/
  caches/
    cargo/
    rustup/
    rust-targets/
    sccache/
    gradle/
    bun/
    npm/
    pnpm/
    uv/
    pip/
    playwright/
    docker-buildx/
  build/
    <project>/
      rust-target/
      xcode/
      gradle/
      cmake/
      electron/
      node/
      python/
  releases/
    <project>/
      dev/
      nightly/
      stable/
      diagnostics/
  artifacts/
    <project>/
  docker/
    orbstack/
      data/
  vms/
    vmware/
  resources/
  archives/
  tools/
    bin/
  tmp/
    scratch/
  policies/
  logs/
```

## Project Path Rule

Start every serious project under:

```text
/Volumes/code-bank/code/<project>
```

Working from this path is also fine:

```text
~/projects/<project>
```

That is a symlink for compatibility with old paths. Do not create a second copy
of the project on the internal disk.

## New Project Setup

Then run:

```sh
project-storage-init
```

This adds:

```text
.project-storage.toml
.envrc.example
docs/storage-protocol.md
scripts/space-report
scripts/clean-soft
scripts/clean-deep
scripts/rust-target-report
scripts/rust-target-prune
.gitignore generated-output section
```

For existing trees or nested projects, audit with:

```sh
project-storage-check /Volumes/code-bank/code
project-storage-check /Volumes/code-bank/code --init-missing
```

## Environment Contract

Global shell startup loads:

```text
~/.dev-storage-env
```

That file exports external roots for npm, Bun, pip, uv, Cargo, rustup, Gradle,
sccache, and ccache. Long-running terminals, agents, and dev servers must be
restarted to pick up those values.

Expected roots:

```text
NPM_CONFIG_CACHE=/Volumes/code-bank/caches/npm
BUN_INSTALL_CACHE_DIR=/Volumes/code-bank/caches/bun/install-cache
PIP_CACHE_DIR=/Volumes/code-bank/caches/pip
UV_CACHE_DIR=/Volumes/code-bank/caches/uv
CARGO_HOME=/Volumes/code-bank/caches/cargo/home
RUSTUP_HOME=/Volumes/code-bank/caches/rustup/home
GRADLE_USER_HOME=/Volumes/code-bank/caches/gradle/home
SCCACHE_DIR=/Volumes/code-bank/caches/sccache
CCACHE_DIR=/Volumes/code-bank/caches/ccache
```

Project-local `.envrc` files may also set:

```text
PROJECT_BUILD_DIR=/Volumes/code-bank/build/<project>
PROJECT_RELEASE_DIR=/Volumes/code-bank/releases/<project>
CARGO_TARGET_DIR=/Volumes/code-bank/build/<project>/rust-target
PROJECT_ARTIFACT_DIR=/Volumes/code-bank/artifacts/<project>
PROJECT_SCRATCH_DIR=/Volumes/code-bank/tmp/scratch/<project>
PROJECT_LOG_DIR=/Volumes/code-bank/logs/<project>
```

## Ecosystem Rules

Node/npm/pnpm:

- package manager cache uses `/Volumes/code-bank/caches/npm` or
  `/Volumes/code-bank/caches/pnpm`;
- `node_modules` is rebuildable and must be ignored by git;
- generated directories such as `.next`, `.turbo`, `.vite`, `dist`, `build`,
  `out`, coverage, and test output are rebuildable;
- release zips/installers do not belong in the project root long term.
- app bundles, installers, and release zips belong under
  `/Volumes/code-bank/releases/<project>`.

Bun:

- install cache uses `/Volumes/code-bank/caches/bun/install-cache`;
- `node_modules` and `.bun` are rebuildable;
- use `bun install` to restore deleted deps.

Python:

- pip and uv caches use `/Volumes/code-bank/caches/pip` and
  `/Volumes/code-bank/caches/uv`;
- `.venv`, `venv`, `.tox`, `.nox`, `__pycache__`, `.pytest_cache`,
  `.mypy_cache`, `.ruff_cache`, and coverage output are rebuildable;
- virtualenvs should stay inside the external project tree or be recreated.

Rust:

- Cargo and rustup homes live under `/Volumes/code-bank/caches`;
- large projects should set `CARGO_TARGET_DIR` to
  `/Volumes/code-bank/build/<project>/rust-target`;
- local `target/` is allowed only because the project itself is on the external
  drive, but it is still rebuildable;
- use `rust-target-care` for stale duplicate target artifacts.

Gradle/Android:

- `GRADLE_USER_HOME` is `/Volumes/code-bank/caches/gradle/home`;
- `.gradle/`, `build/`, `android/app/build/`, and test output are rebuildable;
- release APK/AAB files should be copied to `/Volumes/code-bank/releases/<project>`.

Docker/OrbStack:

- Docker currently runs through OrbStack.
- OrbStack's backend data is external-backed at
  `/Volumes/code-bank/docker/orbstack/data`.
- The original OrbStack backend path is a compatibility symlink:
  `~/Library/Group Containers/HUAQ24HBR6.dev.orbstack/data`.
- Generic project cleanup must not delete named Docker volumes or runtime data
  unless the user explicitly says they are disposable.
- Project Docker builds should export durable outputs to
  `/Volumes/code-bank/releases/<project>` for app deliverables or
  `/Volumes/code-bank/artifacts/<project>` for non-release reports.
- If using BuildKit local cache, put it under
  `/Volumes/code-bank/caches/docker-buildx/<project>`.
- Prune Docker periodically with intent; keep named release/build cache volumes
  that are actively useful.

VMware Fusion:

- VMware virtual machines live under `/Volumes/code-bank/vms/vmware`.
- The Windows 11 ARM VM is external-backed at
  `/Volumes/code-bank/vms/vmware/Windows 11 64-bit Arm.vmwarevm`.
- The old VMware library path is a compatibility symlink:
  `~/Virtual Machines.localized/Windows 11 64-bit Arm.vmwarevm`.
- Do not duplicate VM bundles back onto the internal disk.
- Shut down VMs cleanly before future moves or backups; suspended `.vmem` and
  `.vmss` files are large and should be treated as VM state, not cache.

Custom Tools:

- Shared custom tools belong in `/Volumes/code-bank/tools/bin`.
- `~/.dev-storage-env` adds this directory to `PATH` for new shells and agents.
- Prefer this location for development-machine utilities that should travel with
  the code bank.

## Build And Release Layout

Build outputs are bucket-first, then project-specific:

```text
/Volumes/code-bank/build/<project>/
  rust-target/
  xcode/
  gradle/
  cmake/
  electron/
  node/
  python/
```

Release deliverables use the same bucket-first shape:

```text
/Volumes/code-bank/releases/<project>/
  dev/YYYY-MM-DD-HHMMSS/
  nightly/YYYY-MM-DD/
  stable/<version>/
  diagnostics/YYYY-MM-DD-HHMMSS/
```

Use predictable filenames:

```text
<project>-<version>-<platform>-<arch>.<ext>
```

Examples:

```text
shadowboy-run-1.4.2-macos-arm64.dmg
shadowboy-run-1.4.2-windows-x64.exe
shadowboy-run-1.4.2-linux-x64.AppImage
shadowboy-run-1.4.2-android-arm64.apk
```

Development/debug outputs are disposable. Release outputs are durable only when
they are in `releases/<project>/stable/<version>` or archived.

Use `/Volumes/code-bank/artifacts/<project>` only for intentional non-release
generated outputs that do not fit the release tree, such as preserved reports or
handoff bundles.

## Retention And Budgets

Default retention:

```text
deps: rebuildable, removable any time
package caches: keep while useful; review when caches exceed 250G total
build caches: keep while useful; review when build exceeds 300G total
dev artifacts: keep 14 days or latest 10 per project
nightly artifacts: keep 21 days or latest 10 per project
release artifacts: keep latest 5 per project, plus pinned important releases
logs/diagnostics: keep 7-14 days unless manually preserved
scratch: keep 1-3 days
runtime-data: never removed by generic cleanup
```

Drive-level thresholds:

```text
internal disk: keep at least 80-100 GiB free
/Volumes/code-bank: investigate when free space drops below 150 GiB
/Volumes/code-bank/caches: investigate above 250 GiB
/Volumes/code-bank/build: investigate above 300 GiB
/Volumes/code-bank/releases: investigate above 200 GiB
/Volumes/code-bank/artifacts: investigate above 200 GiB
```

These are management thresholds, not reasons to delete source or runtime data.

## Cleanup Commands

Dry-run scan:

```sh
project-diet scan /Volumes/code-bank/code --profile code-only
```

Archive before destructive pruning:

```sh
project-diet archive /Volumes/code-bank/code \
  --dest /Volumes/code-bank/archives \
  --execute
```

Prune only after archive:

```sh
project-diet prune /Volumes/code-bank/code \
  --profile code-only \
  --execute \
  --archive-confirmed
```

Use `standard` for normal cleanup of dependencies, caches, logs, and build
output. Use `code-only` only after archiving or when the user explicitly wants a
project reduced back toward source code.

## Rust Target Care

Rust target directories can accumulate many hash-suffixed stale versions of the
same crate or binary, especially under `target/debug/deps`.

Read-only report:

```sh
rust-target-care report target --older-than 2 --keep-hashes 3
```

Dry-run stale duplicate pruning:

```sh
rust-target-care prune target --older-than 2 --keep-hashes 3 --keep-dirs 2
```

Execute only when the project is not actively compiling:

```sh
rust-target-care prune target \
  --older-than 2 \
  --keep-hashes 3 \
  --keep-dirs 2 \
  --execute \
  --rebuildable-confirmed
```

## Codex History Path Migration

After moving projects from the internal disk to `/Volumes/code-bank/code`,
audit Codex sessions/history for old path references:

```sh
codex-path-care scan --old /Users/catalystlabs/projects
```

Dry-run remap:

```sh
codex-path-care remap \
  --old /Users/catalystlabs/projects \
  --new /Volumes/code-bank/code
```

Execute after reviewing the dry-run:

```sh
codex-path-care remap \
  --old /Users/catalystlabs/projects \
  --new /Volumes/code-bank/code \
  --execute
```

The tool creates timestamped backups under `~/.codex/backups/` before writing.

## Internal Disk Rule

The internal disk should not be the default location for:

```text
project roots
Rust target dirs
node_modules for migrated projects
Python venvs for migrated projects
Gradle caches/build output
release artifacts
large model/ROM/VM/runtime data
```

Keep at least 80-100 GB free on the internal disk.

## Agent Rules

When an agent starts work on any project:

1. Read `/Volumes/code-bank/code/AGENTS.md`.
2. Read the project's `docs/storage-protocol.md` if present.
3. Confirm `pwd -P` resolves under `/Volumes/code-bank/code`.
4. Use the exported external cache variables instead of inventing new cache
   paths.
5. Put release/debug/installers/APKs/app bundles under the release layout.
6. Add new generated output paths to `.gitignore` and `.project-storage.toml`.
7. Run `scripts/space-report` before and after large build changes.
8. Never delete `.git`, source, lock files, archives, resources, databases,
   ROMs, models, named Docker volumes, or runtime data without explicit user
   confirmation.
