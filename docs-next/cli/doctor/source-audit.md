---
id: zero.doctor.source-audit
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: source-audit
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

# Source Usage Rules And Scoped Exceptions

[Doctor index](./index.md) · [Documentation index](../../index.md)

`runUsageAudit` heuristically reads app-owned TypeScript/JavaScript source.
It returns Doctor-compatible findings; it does not execute business handlers or
prove AST-level correctness.

Default scan roots are the configured app/server plugin/middleware/endpoint/
route/resource directories plus components, hooks and lib. A nonempty include
list replaces them. Always-excluded segments include .git, .zero, .build,
.storage, coverage, dist and node_modules. Default patterns additionally exclude
test/spec/declaration/generated/vendor files; caller excludes append.

## Rule Families

| Codes | Intent |
| --- | --- |
| usage.frontend.raw_button/raw_input/raw_textarea/raw_select/raw_table | prefer reusable Zero controls |
| usage.frontend.custom_modal/custom_toast/direct_lucide/internal_animate_ui | use the public shared presentation boundary |
| usage.frontend.custom_data_fetch/custom_sync_socket/local_auth_storage | use authenticated SDK/session/Sync transports |
| usage.import.legacy_platform_alias/framework_internal | avoid legacy/private imports |
| usage.backend.direct_sqlite/direct_resend/direct_ai_sdk/direct_zvec/direct_jwt/console | use scoped platform services and standard observability |
| usage.frontend.app_provider_missing/theme_provider_missing/toaster_missing | root wiring heuristic |
| usage.backend.auth_stop_barrier_missing | standalone auth composition needs awaited stop joining |
| usage.structure.large_file | review mixed responsibilities above default 400 lines |

Rules search matching source lines; comments beginning with // are skipped in
ordinary per-line rules. False positives/negatives are possible. A trusted
exception does not imply ordinary browser/server code has new unsafe access.

## Paths And Exceptions

Literal patterns match an exact relative path or directory prefix. * matches
within one segment; ** spans directories; **/ admits zero or multiple
directories. The recursive semantics describe the **unreleased correction**:
the original baseline accidentally rewrote generated wildcard regex and missed
recursive exclusions/allow paths. Defaults and public option shapes remain.

Complete options value example:

```ts
import type { UsageAuditOptions } from "@zero/framework/doctor";

export const usagePolicy = {
  include: ["app", "server", "components"],
  exclude: ["server/vendor/**"],
  maxFileLines: 400,
  rules: { "usage.backend.console": "error" },
  allow: [{ code: "usage.frontend.raw_button", path: "components/specialized/**" }],
} satisfies UsageAuditOptions;
```

An allow entry suppresses only its matching code/path after scanning; path line
suffixes are removed before matching. Record why the app needs that exception.
Do not turn off whole families just because one specialized file requires them.

## Verification And Related Guides

The corrected development path/audit/lifecycle regressions pass with temporary
source fixtures (10 tests/32 assertions), not a real app or installed artifact.
[Options](./configuration.md#usageauditoptions), [CI](./usage.md) and
[agent conventions](../../agents/tooling/building-conventions.md) connect source
rules to real platform APIs; backend authority still requires integration tests.
