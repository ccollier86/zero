---
id: zero.doctor.database-automations
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: database-automations
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

# Diagnose Automation Definitions And Delivery Health

[Doctor index](./index.md) · [Documentation index](../../index.md)

`checkDatabaseAutomations(input, findings)` is a public synchronous checker.
Input chooses either a Fabric `realm` or a pinned `registry` plus `tables`;
do not mix both forms. The findings argument needs push capability; an array of
PlatformDoctorFinding works without importing internal checker sinks.

Optional input fields are `infrastructure`, `reportedFingerprints`,
`health`, and diagnostic `path` (default databaseAutomations).
The checker does not run handlers, open sources, claim leases or control workers.

## Readiness And Drift

Infrastructure declares:
`storage: ephemeral | durable`,
`outbox: absent | ephemeral | durable`, and `dispatcherEnabled: boolean`.
Durable AFTER functions require coherent persisted source/outbox/dispatcher
policy; a transaction function has different needs.

Fingerprint input optionally supplies realm/automations values reported by the
live generation. Definition/realm drift yields explicit findings, including
database.automations.actor_manifest_drift and actor_realm_drift. Changing handler
behavior without manifest shape still needs explicit version bumps; fingerprints
are not arbitrary code/closure hashes.

## Aggregate Operational Health

Health supplies nonnegative safe-integer pending, processing, dead, staleLeases
and backlog counts. backlog includes delayed retries, not just pending claims.
Optional positive backlogLimit and warningBacklog thresholds drive capacity
error and high-backlog warning findings.

Dead work and expired unreclaimed leases are errors; active/idle aggregate
status is info. Invalid aggregate inputs fail as health.invalid. Never supply
delivery IDs, business inputs, lease tokens or outbox records in this snapshot.

Complete type-only snapshot example:

```ts
import type { DatabaseAutomationInfrastructureSnapshot,
  DatabaseAutomationOperationalHealth } from "@zero/framework/doctor";

export const infrastructure = {
  storage: "durable", outbox: "durable", dispatcherEnabled: true,
} satisfies DatabaseAutomationInfrastructureSnapshot;
export const health = {
  pending: 2, processing: 1, dead: 0, staleLeases: 0, backlog: 4,
  backlogLimit: 100, warningBacklog: 75,
} satisfies DatabaseAutomationOperationalHealth;
```

App-owned health adapters must produce accurate aggregates; a declared snapshot
alone cannot prove the dispatcher is running.

## Related Guides And Next Steps

[Definitions](../../backend/database-automations/validation.md),
[delivery](../../backend/database-automations/delivery.md) and
[operations](../../backend/database-automations/operations.md) own the runtime
contracts. [Fabric](../../backend/fabric/index.md) owns generation replacement.
