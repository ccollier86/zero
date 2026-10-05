---
id: zero.inventory.agent-tooling
type: inventory
audience: [agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Coding-Agent Guidance And Development Tooling

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

Owns Zero's developer-facing agent orientation, current knowledge bundles, use-first conventions and existing CLI/Doctor integration paths. This is **coding-agent development tooling**, distinct from Zero AIService's application agents/tools and planned MCP gateway.

## Actual Files And Features

Tracked source-file enumeration found llm.txt and llms.txt, current documentation/bootstrap inputs and tooling modules. It did **not** find a committed project AGENTS.md/CLAUDE.md, .codex/.claude/.cursor instruction configuration, SKILL.md package, or executable coding-agent hook/MCP-server definition. That is a repository-baseline statement, not a scan or denial of external user-installed/global tools. Ancestor development/storage instructions govern this workspace but are not Zero package features.

| Feature | Current surface/evidence and maturity | Canonical draft guide |
| --- | --- | --- |
| Compatibility agent entry | llm.txt links canonical bundle; [llm.txt](../../../../llm.txt); implemented shipped file | [agents/tooling/entrypoints.md](../../../agents/tooling/entrypoints.md) |
| Comprehensive bundle | llms.txt, 3187 source lines; duplicate summarized contracts/rules/imports/examples; [llms.txt](../../../../llms.txt) | [agents/tooling/knowledge-bundle.md](../../../agents/tooling/knowledge-bundle.md) |
| Bootstrap orientation | Current docs bootstrap prompt/source map and standards; [docs/bootstrap-prompt.md](../../../../docs/bootstrap-prompt.md), [docs/engineering-standards.md](../../../../docs/engineering-standards.md) | [agents/tooling/onboarding.md](../../../agents/tooling/onboarding.md) |
| Use-first component/hooks/services rules | Existing bundle engineering rules and component inventory; package public routes source-reconciled here | [agents/tooling/building-conventions.md](../../../agents/tooling/building-conventions.md) |
| Package-local documentation | package files ships docs/llm/llms/README; generated README points installed docs; [package.json](../../../../package.json), [src/create-zero/scaffold.ts](../../../../src/create-zero/scaffold.ts) | [agents/tooling/package-discovery.md](../../../agents/tooling/package-discovery.md) |
| Existing verification integration | Doctor CLI/API and app typecheck scripts, source usage diagnostics; separate Doctor/CLI inventories | [agents/tooling/verification.md](../../../agents/tooling/verification.md) |
| Existing scaffold/source-copy/update tools | Six zero subcommands and four saved-package launchers; separate CLI inventory | [agents/tooling/cli-workflows.md](../../../agents/tooling/cli-workflows.md) |
| Git release hooks | Installer-generated post-commit/post-merge definitions; [src/local-tools/install.ts](../../../../src/local-tools/install.ts) | [agents/tooling/release-hooks.md](../../../agents/tooling/release-hooks.md) |
| Compact onboarding/catalog/agent hooks/skills/MCP | **Planned**, not installed coding-agent capabilities; [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) | [agents/tooling/roadmap.md](../../../agents/tooling/roadmap.md) |

## Public Surface And Integration Map

The npm bins are zero/create-zero, not an MCP server or capability-query command. Git hooks refresh saved packages on main, not a general agent lifecycle/Doctor hook framework. Custom Git hooks/core.hooksPath are preserved; this audit inspected definitions only, not active external hooks or workstation configs.

Agent guidance should load public installed package contracts, then focused subsystem evidence, use supported package imports and existing UI/services, and preserve app-owned code. Existing bundle asks for broad preloading and repeats manuals; future compact routing/catalog is planned. Current app agents/tools in /ai belong application AI/Torrent documentation, not this developer-tool inventory.

## Configuration And Procedure Inventory

No agent runtime configDir/init-config/instruction auto-discovery/catalog query/MCP config is exposed by current Zero dispatch/package routes. Current coding-agent workflow knobs are existing CLI flags and Doctor usageAudit/strict/include/exclude/rule/allow options. Hooks/library/release/scratch installer paths are environmental installation settings inventoried by CLI, not Zero runtime authorization.

Agent execution of Doctor imports trusted config/resources and can inspect existing DBs; typecheck/app scripts/hooks may have arbitrary side effects. New guidance must use inspected disposable fixtures/synthetic env with automatic env loading disabled for authorized checks. “Use-first” is not authorization to mutate apps, runtimes, credentials, storage, migrations or deployments. No executable agent instructions/hooks were added during this inventory.

## Evidence And Verification

Static evidence: tracked path enumeration, llm/llms content, source dispatch/scaffolder/installer and package allowlist. Tests present: [src/create-zero/scaffold.test.ts](../../../../src/create-zero/scaffold.test.ts), [src/package-distribution.test.ts](../../../../src/package-distribution.test.ts), [src/local-tools/stable-release.test.ts](../../../../src/local-tools/stable-release.test.ts), [src/doctor/usage-audit.test.ts](../../../../src/doctor/usage-audit.test.ts). No fresh-agent task, installed package, active Git hook or tool execution was verified.

## Findings, Philosophy, And Known Future Plans

- Concrete documentation drift: llms.txt:2232 suggests zero migrate --doctor --schema ./db/schema.ts --strict without --db. [src/migrations/migration-cli-target.ts](../../../../src/migrations/migration-cli-target.ts) explicitly requires --db for application schema inspection. New agent docs must use the actual target contract; old files remain unchanged in this isolated pass.
- Bundle's Doctor usage-plan introduction says “planned” at llms.txt:210 while source usage checks exist. Separate implemented diagnostics from historical proposal.
- Source-local bundles repeat current contracts and can drift. A metadata-driven compact entrance/catalog is future work, not an existing source of API truth.
- Package export wildcard accidentally admits three UI test routes; agents must not discover/teach those as components.
- Established philosophy: agent-first and human-clear, declarative yet explicit authority/lifecycle, public import/use-first discipline. Roadmap catalog, onboarding, Codex/Claude hooks/skills and MCP gateway remain explicitly planned with provenance.

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
