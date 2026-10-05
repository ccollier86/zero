---
id: zero.inventory.cli-tooling
type: inventory
audience: [agent, maintainer]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# CLI, Scaffolding, Safe Updates, And Local Release Tools

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed; its independent source contract review is complete, while whole-platform and package reconciliation remain separate gates. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Independent Source Contract Review

Reviewed independently on 2026-10-05 against the pinned baseline's public
barrels, implementations, configuration/argument definitions and runtime
composition. The feature groups in this inventory are reconciled; the full
platform map, detailed guides and installed-package qualification are separate
gates. Authorized post-baseline source corrections remain supplemental dirty
working evidence, not released support. No app configuration, Doctor, live data,
provider or environment file was executed for this contract review.

## Purpose And Terminology

Owns command routing, package-mode scaffolding, explicit source copying, dependency updates and saved committed-package launchers. Doctor, migrations and PDF are separate subsystems whose CLI paths are routed here. Source-local command engines are not invented package exports.

## Features And Documentation Coverage

[src/cli/run.ts](../../../../src/cli/run.ts) dispatches **six subcommands**; [package.json](../../../../package.json) declares **two bins** (zero/create-zero). The local installer defines **four launcher commands**; they are not additional npm bins. Every command below is source-observed, not executed.

| Command/feature | Exact options/public surface/evidence | Side-effect boundary | Canonical draft guide |
| --- | --- | --- | --- |
| zero dispatch/help | add/create/doctor/migrate/pdf/update; --help/-h; [src/cli/run.ts](../../../../src/cli/run.ts) | Routes to subsystem commands; no-argument usage returns1 | [cli/tooling/dispatch.md](../../../cli/tooling/dispatch.md) |
| zero create / create-zero | One target; --name/--template/--zero/--force/--install/--local/--help/-h; [src/create-zero/cli-args.ts](../../../../src/create-zero/cli-args.ts), [src/create-zero/run.ts](../../../../src/create-zero/run.ts) | Staged filesystem replacement; force may replace nonempty target; install executes bun install/app dependency scripts | [cli/tooling/create.md](../../../cli/tooling/create.md) |
| Package-mode scaffolding | scaffoldZeroApp options/results source-local; [src/create-zero/scaffold.ts](../../../../src/create-zero/scaffold.ts) | Writes app files/directories/README/package/tsconfig; no registry/local shortcut inferred | [cli/tooling/scaffolding.md](../../../cli/tooling/scaffolding.md) |
| zero add | items; --target/--force/--dry-run/--list/--help/-h; [src/add/run.ts](../../../../src/add/run.ts) | Copies/rebases selected source/dependencies; skips existing unless force; dry-run plans | [cli/tooling/add.md](../../../cli/tooling/add.md) |
| Addable registry | 20 static targets plus components/ui/<name>; [src/add/registry.ts](../../../../src/add/registry.ts), [src/add/copy.ts](../../../../src/add/copy.ts) | App-owned customization, not managed package upgrades | [cli/tooling/source-copy.md](../../../cli/tooling/source-copy.md) |
| zero update | --project (also =value)/--local (also =value)/--latest/--dry-run/--check/--skip-checks/--help/-h; [src/update/run.ts](../../../../src/update/run.ts) | Framework dependency/archive/lock/install state; default ignore-scripts; --check invokes app typecheck/Doctor outside updater rollback | [cli/tooling/update.md](../../../cli/tooling/update.md) |
| zero doctor | --config/--strict/--json/--no-usage-audit/--max-file-lines/--usage-include/--usage-exclude/--help/-h | Imports trusted config/resource modules; source/filesystem/DB inspection; see Doctor inventory | [cli/doctor/index.md](../../../cli/doctor/index.md) |
| zero migrate | --status/--checkpoint/--doctor/--plan/--strict/--allow-destructive/--allow-destructive-down/--no-backup/--write/--to/--down-to/--db/--schema/--backup-dir/--version/--name/--out/--help/-h; [src/migrations/run.ts](../../../../src/migrations/run.ts) | DB/ledger/backup/write-plan operations; schema import executes; status/plan are not assumed pure static | [backend/migrations/cli.md](../../../backend/migrations/cli.md) |
| zero pdf | status/install/help/--help/-h; install --with-deps; [src/pdf/run.ts](../../../../src/pdf/run.ts) | status inspects managed executable; install downloads browser; with-deps may alter OS dependencies | [backend/pdf/index.md](../../../backend/pdf/index.md) |
| Install local launchers | bun run install:local-tools; [scripts/install-local-tools.sh](../../../../scripts/install-local-tools.sh), [src/local-tools/install.ts](../../../../src/local-tools/install.ts) | Writes external tools/library/releases and repo Git hooks; custom hooks preserved | [cli/tooling/local-install.md](../../../cli/tooling/local-install.md) |
| zero-new | target defaults .; --name/--force/--skip-install (alias --no-install)/--install/--help/-h; [src/local-tools/run.ts](../../../../src/local-tools/run.ts) | Saved package/template only; installs by default; rejects local/zero/template overrides | [cli/tooling/zero-new.md](../../../cli/tooling/zero-new.md) |
| zero-update | project positional or --project; --dry-run/--check; rejects local/latest overrides | Uses saved archive, writes provenance when mutating; does not pack live checkout | [cli/tooling/zero-update.md](../../../cli/tooling/zero-update.md) |
| zero-doctor | Doctor options; resolves installed app's framework entry | Executes app-installed Doctor, not live checkout | [cli/tooling/zero-doctor.md](../../../cli/tooling/zero-doctor.md) |
| zero-release | Optional exact local branch; --status; default main; [src/local-tools/stable-release.ts](../../../../src/local-tools/stable-release.ts) | Creates checksum/provenance archive from Git objects, selects saved stable; status reads/validates archive | [cli/tooling/releases.md](../../../cli/tooling/releases.md) |
| Legacy helper/maintainer scripts | create-project.sh target/skip-install/create flags; version:bump semver; private-imports:sync; auth:psl:update | Repository maintenance/source generation/network as implemented; not safe app verification shortcuts | [cli/tooling/maintainer-scripts.md](../../../cli/tooling/maintainer-scripts.md) |

## Public Surface And Integration Map

Scaffold starter comes from packaged examples/package-mode. --local explicitly packs eligible working-tree files; saved launchers instead consume validated committed-branch archives and record zero-release.json. Releasing defaults to main but an exact local branch can be selected; only main auto-refreshes through managed post-commit/post-merge definitions. Existing custom hooks/core.hooksPath are preserved/require explicit coordination.

Updater requires exactly one Bun lockfile. Local archive mode requires the managed archive dependency/text lock; private unique staged references refresh framework transitive metadata, then restore manifest bytes/canonical archive binding and verify installed package files. Default updater does not regenerate app source/config/env/storage/DB or choose migrations. Reversible install-state rollback cannot undo app-script side effects. Source copying and --force scaffolding are not update paths.

## Configuration Inventory

- Scaffolder target/name/template/zero dependency/local/install/force parsed at command invocation; force scope validated by safety/transaction modules.
- Updater project/mode/local source/latest/dryRun/check/skipChecks at invocation; latest conflicts local, check conflicts skipChecks. Registry mode manages configured dependency versus explicit latest.
- Local installer environment names DEV_DRIVE/ZERO_LOCAL_BIN_DIR/ZERO_LOCAL_TOOLS_DIR/ZERO_RELEASE_DIR/ZERO_TOOLS_SCRATCH_DIR choose external locations at installation; only names inspected, no actual values read.
- Saved ToolsConfig repo/releases/scratch and StableRelease schema/source/branch/commit/version/sha256/createdAt define archive provenance; not app runtime secrets.
- Migrations target --db, then SYSTEM_DB_PATH, then data/zero.system.db; application --schema inspection requires explicit --db and never falls back to system plane.
- Repository package scripts and generated app scripts are different surfaces. Build/typecheck/test commands can write caches/output; invoking app scripts needs trust/scope review.

The [tooling configuration reference](../../../cli/tooling/configuration.md) now documents these defaults; subsystem-specific options remain canonical in Doctor/Migrations/PDF guides.

## Evidence And Verification

Tests present: [src/create-zero/cli-args.test.ts](../../../../src/create-zero/cli-args.test.ts), [src/create-zero/scaffold.test.ts](../../../../src/create-zero/scaffold.test.ts), [src/create-zero/scaffold-safety.test.ts](../../../../src/create-zero/scaffold-safety.test.ts), [src/add/copy.test.ts](../../../../src/add/copy.test.ts), [src/update/run.test.ts](../../../../src/update/run.test.ts), [src/update/bun-lock-integrity.test.ts](../../../../src/update/bun-lock-integrity.test.ts), [src/update/local-archive-resolution.test.ts](../../../../src/update/local-archive-resolution.test.ts), [src/update/local-archive-resolution.integration.test.ts](../../../../src/update/local-archive-resolution.integration.test.ts), [src/local-tools/stable-release.test.ts](../../../../src/local-tools/stable-release.test.ts), [src/package-distribution.test.ts](../../../../src/package-distribution.test.ts). Examples package-mode/generated README. Existing [docs/releasing.md](../../../../docs/releasing.md) and README are research input. No command was run in this inventory.

## Findings, Philosophy, And Known Future Plans

- Trust gap in old guidance: “Doctor/plan/dry-run” must describe actual import/filesystem/data effects, not imply all diagnostics are static.
- No init-config/configDir/focused-config discovery command exists in dispatch; proposed helpers remain planned.
- Packaging test-wildcard finding belongs package review; do not teach test routes.
- Established philosophy: explicit package provenance, scoped update ownership, reversible managed state and deliberate app-owned customization.
- Capability catalog, smarter agent verification, focused config and broader release tooling in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) remain future proposals.

## Navigation And Completion Review

The section entrance/configuration/roadmap and per-feature homes above now link to created reader drafts with parent indexes, contextual links and related next steps. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent source/contract review of this inventory.
- [ ] Whole-platform reconciliation.
- [ ] Exact-package/export/example/mode qualification.
- [x] Reader-facing draft guides, configuration references, philosophy and roadmaps linked; artifact and independent detailed review remain separate.

## Detailed Draft Closeout

Created source-reconciled draft feature/configuration/index/roadmap pages on
2026-10-05. Every feature-group destination above now resolves to an actual
page. Reader status remains draft/internal: source inspection, focused working
corrections and example checks do not qualify an archive or production mode.
No current docs, package entries, app projects or active agent files were
changed. CLI operational examples were not executed.
