---
id: zero.doctor.configuration
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Doctor Options And Finding Contracts

[Doctor index](./index.md) · [Documentation index](../../index.md)

Public APIs/types are exported from `@zero/framework/doctor`. There is no
global Doctor settings table or automatic config rewrite.

## PlatformDoctorOptions

| Option | Type / default | Effect |
| --- | --- | --- |
| strict | boolean; false | errors always fail; warnings also fail when true; info never fails |
| env | record of string or undefined; process.env | selected resolution/provider checks; not an import or process sandbox |
| projectRoot | optional path | source scanning and read-only existing SQLite inspection |
| usageAudit | boolean or UsageAuditOptions; enabled when projectRoot exists | false disables source audit only, not other checks |

`runPlatformDoctor(config, options?)` synchronously returns
`{ findings: PlatformDoctorFinding[], ok: boolean }`.
Each finding contains `severity: info | warning | error`, stable `code`,
`message`, and optional `path`, `hint`, `docs`. Findings are diagnostics;
do not serialize the effective secret-bearing config into your report.

## UsageAuditOptions

| Field | Default / semantics |
| --- | --- |
| enabled | true |
| include | nonempty list replaces configured/default source roots; relative paths resolve under projectRoot |
| exclude | caller patterns append to built-in exclusions |
| maxFileLines | 400; files over the threshold get a responsibility-review finding |
| rules | map code→info/warning/error/off; unspecified rule severity is warning |
| allow | {code,path} entries suppress matching rule/path findings; line suffix is ignored |

`runUsageAudit({ projectRoot, resolvedConfig, options? })` returns only source
findings. It needs an already resolved configuration and performs source reads.
[Source-audit semantics](./source-audit.md) own pattern/rule details, including
the unreleased recursive-glob correction.

## CLI Flags

`zero doctor` accepts `--config <path>`, `--strict`, `--json`,
`--no-usage-audit`, `--max-file-lines <positive integer>`,
repeatable `--usage-include <path>` / `--usage-exclude <pattern>`,
and `--help/-h`. Invocation options select diagnostics, not backend access.
There is no CLI synthetic-env option; process/env-file behavior remains Bun's
execution environment. Use the programmatic API for explicit synthetic env.

[Loading](./config-loading.md), [reports](./configuration-checks.md),
[automation inputs](./database-automations.md) and
[CI usage](./usage.md) provide integration examples.
