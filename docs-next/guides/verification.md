---
id: zero.guides.verification
type: operations
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: verification
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Verify The Contract At The Right Level

[Guides index](./index.md) · [Documentation index](../index.md)

Use the smallest check that proves the changed contract, then broader gates
for integration/release. A passing global test count cannot replace a missing
authorization or concurrency scenario.

## Evidence Levels

| Check | Establishes | Does not establish |
| --- | --- | --- |
| Source/export inspection | Current implementation and supported source imports | Shipped artifact behavior |
| Typecheck actual examples | Declared types and public facade usage | Runtime auth, migration or provider success |
| Focused synthetic regression | The reproduced contract under controlled input/races | Every deployment or native driver |
| Disposable integration fixture | Composed behavior for the tested modes | Live production readiness |
| Exact package qualification | Artifact exports/examples/docs/provenance | Every app's data conversion |
| Deployment smoke | Selected deployed workflow and boundaries | Comprehensive security/compliance certification |

## Useful Scenarios

For data/authority work, test permitted and denied actors, mixed/app-only
Administration memberships, cross-organization reads/writes, role removal,
credential ceilings and old-scope pending requests.

For realtime, test snapshots, accepted/rejected writes, reconnect/revocation,
close during awaited auth and actual page membership versus shared cache.
For workflows, test dependent ordering, retries, cancellation, waits,
correlation, definition versions and recovery.
For journalled/durable operations, force failure and restart as well as success.

## Safety

Use explicit owned temporary data paths, synthetic credentials and disabled
automatic env-file loading for fixture checks. Do not import an app's real config
just to enumerate fields. Doctor imports trusted modules and can inspect data;
scope it deliberately.

Use Bun/Elysia in the actual intended integration path. Browser DOM/SSR fixtures,
fake provider adapters and native collection tests are different evidence:
report which was exercised. Do not describe a synthetic renderer as a real
Chromium render or a fake vector adapter as a native deployment qualification.

## Errors And Logs

Check stable Zero error codes/envelopes and the owning app's observability
runtime. A failed notification after accepted persistence should not imply
retrying a write. Safe normal metadata does not universally sanitize app/provider
errors, secrets or payloads.

See [observability](../backend/observability/index.md),
[Doctor](../cli/doctor/index.md), [service boundaries](../concepts/service-boundaries.md),
[upgrade](./upgrade.md) and the relevant feature's operation guide.
