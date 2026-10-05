---
id: zero.doctor
type: index
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: doctor
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

# Doctor: Configuration And Source Diagnostics

[CLI index](../index.md) · [Documentation index](../../index.md)

Doctor produces structured, actionable findings about declared configuration,
source usage and selected existing infrastructure. It is a diagnostic system,
not an automatic fixer, comprehensive security audit or proof of runtime
readiness.

## Guides

- [Usage and CI](./usage.md): CLI output, exit policy and focused execution.
- [Configuration](./configuration.md): exact public options/defaults.
- [Config loading](./config-loading.md): discovery/import/resource trust boundaries.
- [Configuration checks](./configuration-checks.md): public report API and resolution.
- [Check families](./check-families.md): which system owns each finding/remedy.
- [Source audit](./source-audit.md): paths, rules, severity and deliberate exceptions.
- [Infrastructure inspection](./infrastructure-inspection.md): system/app planes and read-only existing SQLite.
- [Automation diagnostics](./database-automations.md): caller-supplied readiness/health/fingerprints.
- [Roadmap](./roadmap.md): proposed discovery and agent verification work.

## Read Stages And Authority

Passing an already constructed config value can avoid module discovery, but
`projectRoot` enables filesystem/source and existing DB inspection. The CLI
loads config and conventional resources, which **executes trusted code**.
Supplying synthetic env does not sandbox those imports.

Treat a warning as a question to resolve, not permission to disable the owning
service's security fence. Inferred philosophy: small focused checkers explain
configuration risk using stable finding codes, while real services own runtime
authority. [Platform resolution](../../backend/configuration/resolution.md)
explains why admission and readiness are different.
