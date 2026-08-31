# Zero Stabilization Plan

This plan freezes broad feature expansion and moves Zero toward a reliable
local framework workflow: audit, shore up existing contracts, tighten docs, and
make local project creation repeatable before the next app build.

## Goals

- Keep existing capability, but stop adding new platform systems in this pass.
- Make the package-mode workflow reliable enough to create and run local apps
  without editing the framework source tree.
- Replace scattered setup knowledge with clear docs, a root README, and
  `llms.txt` for agent-assisted development.
- Review and fix concrete code/docs drift, stale tooling, weak package exports,
  and demo-app assumptions.
- Preserve LaunchBoard as a reference app, but keep generated apps clean and
  framework-driven.

## Current Findings

- `create-zero` scaffolds from the blank `examples/package-mode` starter and
  supports `--zero`, `--local`, `--install`, `--force`, and `--template`.
- `src/create-zero/scaffold.test.ts` performs a valuable outside-tree smoke
  test covering `createApp()`, SSR, sitemap, generated client entry, and build
  assets.
- The package export map is broad and useful, but the package still exports
  TypeScript source files and bin scripts directly from `src/`. That is fine
  for Bun-local use, but it needs explicit docs and a later publish hardening
  pass before npm release.
- `bun run test:package` now verifies package-mode creation, package exports,
  package scripts, and the packed tarball contents required by `create-zero`.
- The repository root has no `README.md`, so a fresh clone has no obvious human
  entry point besides `docs/start-here.md`.
- `llms.txt` now exists as the main agent-facing documentation bundle. It
  should stay comprehensive enough for agents to build with Zero without
  recreating existing platform surfaces.
- `scripts/create-project.sh` was converted into a legacy-name wrapper around
  `create-zero --local`; it no longer copies or directly links `src/` into
  generated apps.
- Docs are extensive, but the most important path should be shorter:
  create app locally, run dev, choose app shape, use platform surfaces first,
  then follow deeper feature docs.
- `git diff --check` may be blocked on this machine by the local Xcode license
  prompt; use direct whitespace scans as a fallback until the license is
  accepted outside this repo.

## Phase 1: Audit And Baseline

1. Run focused checks before and after edits:
   - `bun run typecheck`
   - `bun test src/create-zero/scaffold.test.ts src/package-exports.test.ts`
   - `bun run build`
2. Triage package/create/docs drift:
   - `package.json` exports, bin paths, scripts, and package metadata.
   - `src/create-zero/*` CLI behavior and generated files.
   - `examples/package-mode/*` starter shape.
   - `docs/start-here.md`, `docs/framework/README.md`,
     `docs/framework-developer-surface.md`, and `docs/releasing.md`.
3. Avoid large feature refactors during this phase; record larger ideas as
   backlog instead of implementing them.

## Phase 2: Local Create Flow

1. Add local-framework ergonomics to `create-zero`:
   - `--local` packs the current checkout and points `@zero/framework` at the
     generated app's ignored local archive.
   - `--zero <specifier>` remains the explicit dependency override.
   - `--install` optionally runs `bun install` after scaffolding.
   - `--template <dir>` remains a programmatic option if needed for tests and
     future templates.
2. Add clear usage output:
   - published-style app creation.
   - local framework development app creation.
   - forced overwrite behavior.
3. Keep generated apps package-mode only:
   - app code in `app/`, `server/`, `db/`, and `zero.config.ts`.
   - framework code stays in `node_modules/@zero/framework`.
   - no source-copy setup path in the primary docs.
4. Keep `scripts/create-project.sh` as a legacy-name wrapper over
   `create-zero --local` unless a later cleanup removes it entirely.

## Phase 3: Docs And Agent Surface

1. Add root `README.md` with:
   - what Zero is.
   - local create commands.
   - package-mode folder shape.
   - docs map.
   - verification commands.
2. Maintain `llms.txt` with:
   - comprehensive platform overview and usage guidance.
   - agent rules: use Zero components/hooks/services first.
   - canonical imports.
   - app folder conventions.
   - auth/layout routing rules.
   - built-in systems, package mode, verification commands, and full docs
     catalog with descriptions.
3. Tighten docs links:
   - `docs/start-here.md` should link to `llms.txt`, root README, create flow,
     component inventory, and package-mode docs.
   - `docs/framework/README.md` should include the local create workflow.
   - `docs/releasing.md` should clarify current source-export Bun package mode
     versus later npm publish hardening.

## Phase 4: Package And Distribution Polish

1. Add or verify package metadata:
   - package description.
   - license placeholder/decision.
   - files/publish exclusions.
   - repository metadata once final remote behavior is settled.
2. Keep current Bun-first source exports for local use unless a build-to-dist
   change is deliberately planned.
3. Add a release-readiness note for npm:
   - build artifact strategy.
   - bin strategy.
   - CSS export strategy.
   - peer dependency expectations.
   - smoke test for `bunx create-zero` after publish.

## Phase 5: Stabilization Fixes

1. Fix obvious drift discovered during checks.
2. Prefer small, verifiable changes over broad reorganizations.
3. Keep LaunchBoard as the reference app, but make sure generated starters do
   not inherit demo-only behavior.
4. Update changelog only after concrete changes land.

## Done Criteria

- Local app creation works from this repo with one obvious command.
- Generated app can run outside the framework source tree.
- Root README and `llms.txt` explain what to use and where to look.
- Package-mode docs match the actual CLI and generated starter.
- `bun run test:package` passes, including the tarball smoke test.
- Focused typecheck/tests/build pass or failures are documented with concrete
  blockers.
