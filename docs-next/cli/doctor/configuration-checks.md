---
id: zero.doctor.configuration-checks
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: configuration-checks
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

# Programmatic Configuration Reports

[Doctor index](./index.md) · [Documentation index](../../index.md)

The synchronous public `runPlatformDoctor` accepts an `AppConfig` value.
Pre-resolution checks run first; resolver rejection becomes config.invalid or
auth.config.invalid. Schema and unresolved-automation checks still run where
possible. Resolved domain checks/source audit then run in a defined sequence.

Complete static-value example (no projectRoot, no module loader):

```ts
import { runPlatformDoctor } from "@zero/framework/doctor";
import type { AppConfig } from "@zero/framework/server";

const config = {
  db: { mode: "file", path: "./data/application.db" },
  tables: {},
} satisfies AppConfig;
export const report = runPlatformDoctor(config, {
  env: {}, strict: false, usageAudit: false,
});
export const failureCodes = report.findings
  .filter(finding => finding.severity === "error")
  .map(finding => finding.code);
```

The example describes declaration diagnostics; it does not open an application,
initialize tables or qualify provider readiness. Real resolution can return
warnings/info for disabled or defaulted features.

## Interpreting Findings

Use code plus path to route the remedy. The message explains the observed
condition; hint suggests a safe next step; docs may point into the package's
current documentation tree. Do not reinterpret a warning as a server error
code or expose unchecked loader exception text publicly. In CI, keep sanitized
reports and version provenance.

Invalid config can prevent follow-up domain checks: one run is not an exhaustive
list of every fault. Fix the admission error and rerun the focused check. A
finding-free config is not a complete app runtime or security certification.

## Related Guides And Next Steps

[Check families](./check-families.md) maps ownership,
[options](./configuration.md) defines strict/source/environment policy, and
[automation diagnostics](./database-automations.md) describes explicit runtime
snapshots rather than guessed live health.
