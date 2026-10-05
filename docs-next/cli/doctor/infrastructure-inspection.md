---
id: zero.doctor.infrastructure-inspection
type: architecture
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: infrastructure-inspection
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Existing Database Inspection And Data Planes

[Doctor index](./index.md) · [Documentation index](../../index.md)

Supplying projectRoot enables checks beyond static strings. Doctor may reuse
explicit SQLite/sqlite-wrapper handles or open an **existing** resolved database
file with readonly:true. It never creates a missing database merely to inspect
it. Newly opened handles are closed; caller-owned handles are not disposed.

The configured system plane holds canonical Guardian/control-plane state.
Application data lives separately; shallow user/organization anchors support
business foreign keys. Checks inspect separation, required identity/projection
shape and selected operational readiness. A reused handle is not made globally
read-only by Doctor; only Doctor's inspection queries are intended read-only.

## Paths And Readiness

Path resolution uses the configured persistence mode and explicit root.
Filesystem aliases/overlaps can matter even when text paths differ.
Missing/unsupported inspection targets produce absence/unavailable diagnostics
or skip inapplicable reads; SQLite failures are contained as safe findings
rather than exposing row contents.

Read access can still touch sensitive infrastructure. Use deliberate authority,
inspected configuration and a disposable fixture for tests. `--no-usage-audit`
does not remove these checks, and env:{} does not virtualize filesystem reads.

Doctor does not seed anchors, repair stale memberships, move legacy control
tables, provision tenant files, create migrations, or dump user rows to reports.
If topology/projection fails, fix the owning startup/services before trusting
application mutations.

## Related Guides And Next Steps

[Fabric](../../backend/fabric/index.md) owns physical placement/actors,
[migration planes](../../backend/migrations/data-planes.md) own target safety,
[config loading](./config-loading.md) owns import effects, and
[automation diagnostics](./database-automations.md) uses explicit abstract health
rather than reading outbox payloads.
