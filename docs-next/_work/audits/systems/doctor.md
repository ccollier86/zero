---
id: zero.inventory.doctor
type: inventory
audience: [agent, maintainer]
owner: doctor
status: draft
visibility: internal
system: doctor
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Doctor Configuration And Source Diagnostics

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed; its independent source contract review is complete, while whole-platform and package reconciliation remain separate gates. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Independent Source Contract Review

Reviewed independently on 2026-10-05 against the pinned baseline's public
barrels, implementations, configuration/argument definitions and runtime
composition. The feature groups in this inventory are reconciled; the full
platform map, detailed guides and installed-package qualification are separate
gates. Authorized post-baseline source corrections remain supplemental dirty
working evidence, not released support. No app configuration, Doctor, live data,
provider or environment file was executed for this contract review.

## Purpose And Terminology

Owns app-level config resolution findings, source usage audits and read-only infrastructure health inspection. Doctor is diagnostics, not a comprehensive security audit, runtime proof, migration engine or automatic fixer.

## Features And Documentation Coverage

| Feature | Exact public/source API/evidence | Canonical draft guide |
| --- | --- | --- |
| Config diagnostics/report | runPlatformDoctor; PlatformDoctorOptions/Finding/Report/Severity; /doctor; [src/doctor/index.ts](../../../../src/doctor/index.ts), [src/doctor/platform-doctor.ts](../../../../src/doctor/platform-doctor.ts) | [cli/doctor/configuration-checks.md](../../../cli/doctor/configuration-checks.md) |
| Config discovery/import | resolveDoctorConfigPath/loadDoctorConfig; [src/doctor/config-loader.ts](../../../../src/doctor/config-loader.ts) | [cli/doctor/config-loading.md](../../../cli/doctor/config-loading.md) |
| Source audit | runUsageAudit; UsageAuditOptions/AllowEntry/RuleSeverity; [src/doctor/usage-audit.ts](../../../../src/doctor/usage-audit.ts) | [cli/doctor/source-audit.md](../../../cli/doctor/source-audit.md) |
| Domain checks | Guardian/email/native, tables/resources/Sync, system/application/Fabric, storage/observability/AI/vector/PDF and database automations; orchestrator invokes focused checkers | [cli/doctor/check-families.md](../../../cli/doctor/check-families.md) |
| System/identity projection inspection | Existing handles/files and schema/authority/readiness; [src/doctor/platform-doctor-system-database-state.ts](../../../../src/doctor/platform-doctor-system-database-state.ts), [src/doctor/platform-doctor-system-database-inspection.ts](../../../../src/doctor/platform-doctor-system-database-inspection.ts) | [cli/doctor/infrastructure-inspection.md](../../../cli/doctor/infrastructure-inspection.md) |
| Explicit automation health snapshots | checkDatabaseAutomations and DatabaseAutomationDoctorInput/InfrastructureSnapshot/OperationalHealth/ReportedFingerprints public types | [cli/doctor/database-automations.md](../../../cli/doctor/database-automations.md) |
| CLI/CI presentation | zero doctor and zero-doctor wrappers; strict/JSON/source selection options; [src/doctor/run.ts](../../../../src/doctor/run.ts) | [cli/doctor/usage.md](../../../cli/doctor/usage.md) |

## Public Surface And Integration Map

/doctor explicitly exports the APIs/types above; focused checker functions/local orchestration sinks are internal unless in the package export catalog. Config loader supports config/appConfig/zeroConfig/default object exports, resolves conventional server resource modules, and merges discovered resources for runtime parity.

Loading config/resource modules executes trusted TypeScript/JavaScript. Supplying projectRoot enables source scanning and **read-only existing SQLite inspection**, including reused explicit handles or opening existing files with readonly:true; no create/migrate is intended. Therefore neither CLI Doctor nor runPlatformDoctor with projectRoot is a purely static enumeration tool. Supplied synthetic env controls checks but does not make an imported module safe. Avoid live data/automatic env loading unless separately authorized.

Source rules are heuristic diagnostics for direct/custom UI, transport/SDK/provider/sqlite/JWT/logging/legacy/internal imports and large files; they are not an AST proof of complete business behavior. Guardian policy and actual transport tests remain authoritative.

## Configuration Inventory

| Exact option | Default/timing/effect |
| --- | --- |
| PlatformDoctorOptions.strict | false; warnings fail only with strict, errors always fail. |
| env | Defaults process.env; deliberately supplied synthetic record can isolate provider/config checks; resolution-time. |
| projectRoot | Optional; enables source/infrastructure inspection, not only string analysis. |
| usageAudit | boolean or UsageAuditOptions; false disables usage scanning, not other domain/DB checks. |
| UsageAuditOptions enabled/include/exclude/maxFileLines/rules/allow | enabled true, maxFileLines400; nonempty include replaces default scan roots; default excludes plus caller exclusions; all unspecified usage rule severities default warning, configured info/warning/error/off and code/path allow entries apply at scan-time. |
| Config discovery | zero.config.ts, zero.config.js, config/zero.config.ts, config/zero.config.js in order; explicit --config overrides. |
| CLI strict/json/no-usage-audit/max-file-lines/usage-include/usage-exclude | Invocation overrides; include/exclude repeatable; JSON exposes finding message/path/hint/docs, not effective secret-bearing config. |

The [Doctor configuration reference](../../../cli/doctor/configuration.md) follows actual resolver paths, not declaration comments alone. Doctor can inspect live existing files even while intended read-only, so safe verification requires inspected modules and disposable fixtures.

## Evidence And Verification

Tests present: [src/doctor/config-loader.test.ts](../../../../src/doctor/config-loader.test.ts), [src/doctor/platform-doctor.test.ts](../../../../src/doctor/platform-doctor.test.ts), [src/doctor/platform-doctor-system-database.test.ts](../../../../src/doctor/platform-doctor-system-database.test.ts), [src/doctor/platform-doctor-database-automations.test.ts](../../../../src/doctor/platform-doctor-database-automations.test.ts), [src/doctor/usage-audit.test.ts](../../../../src/doctor/usage-audit.test.ts), [src/doctor/usage-audit-auth-lifecycle.test.ts](../../../../src/doctor/usage-audit-auth-lifecycle.test.ts). Existing [docs/platform-configuration.md](../../../../docs/platform-configuration.md) and [docs/doctor-usage-audit-plan.md](../../../../docs/doctor-usage-audit-plan.md) are research inputs. Nothing imported or executed here.

## Findings, Philosophy, And Known Future Plans

### Supplemental Recursive Source Pattern Correction

The pinned clean baseline's glob implementation rewrote its generated `.*`
globstar output as another ordinary star. Pure path regressions reproduced
both recursive/root test-exclusion and recursive include/allow failures (0
passed, 2 failed). The authorized working correction replaces caller wildcard
tokens once, keeps ordinary stars segment-local, and allows `**/` to match zero
or multiple directories. No regex is injected from literal pattern characters.

Executed 2026-10-05: `bun --no-env-file test
src/doctor/usage-audit-scanner.test.ts src/doctor/usage-audit.test.ts
src/doctor/usage-audit-auth-lifecycle.test.ts` — **10 passed / 32 assertions**.
The public audit regression verifies nested test/generated exclusions and a
recursive allow entry using only owned temporary source fixtures; no app config,
environment file, existing DB or live app was loaded. This is dirty development
evidence, not installed-package qualification. Scanner path semantics are
documented against this correction in the detailed source-audit guide.

- Actual trust boundary: config/resource imports execute; projectRoot inspection may read database files. Any docs/tool describing Doctor as inherently pure static must be corrected against these sources.
- Static findings are not code fixes or complete mode coverage; a clean report is not deployment/security qualification.
- Existing llms.txt still introduces Doctor's usage plan as “planned checks” despite source implementation; new guides must distinguish current rules from old plan language.
- Established philosophy: stable actionable findings and scoped opt-outs, not hidden repair. Future agent hooks/capability discovery are planned in platform roadmap, not implemented by Doctor itself.

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

The actual complete Doctor TS fences were typechecked in memory against the
public source facades as part of the tooling/design/overlay example check
(1 passed / 20 assertions across 19 actual fences). No example was executed:
the config-loader demonstration did not import an app module, and the report
example did not inspect a live database. Snapshot/artifact qualification stays
separate from these successful source-typing checks.
