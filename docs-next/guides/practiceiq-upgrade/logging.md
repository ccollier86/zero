---
id: zero.guides.practiceiq-upgrade.logging
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: in-review
visibility: internal
system: logging
feature: practiceiq-logging-rollout
maturity: preview
applies_to: ["PracticeIQ upgraded to pinned Zero 2.6.0 logging preview"]
modes: [single-tenant, Fabric-logging]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "202b9f7f35c761192ce9089e7ea84c4fbe9c58c3"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: source-observed
---

# Integrate PracticeIQ Logging Deliberately

[PracticeIQ upgrade](./index.md) · [Documentation index](../../index.md)

Enable logging only after the isolated data conversion and ordinary app
authorization pass. Logging is core but optional; updating Zero alone creates
no new log files, workers or browser collection. Do not label this rollout a
complete compliance implementation: `preset: 'compliance'` is still gated by
`LOGGING_NOT_READY`.

## Configure Separate Storage

This is a typed **configuration fragment**, not a replacement for PracticeIQ's
full config or a command to execute against current data:

```ts
import type { AppConfig } from '@zero/framework/server';

export const upgradedPlanes = {
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  databaseTopology: { mode: 'single' },
  logging: {
    rootDirectory: './data/zero.logs',
    preset: 'detailed',
    minimumLevel: 'info',
    metadataKeys: ['operation', 'documentKind', 'rowCount'],
  },
} satisfies Pick<AppConfig, 'systemDb' | 'databaseTopology' | 'logging'>;
```

Merge reviewed slices into the actual typed app config, retaining its app DB,
auth/MFA, trusted properties, route/resource/Sync policy, email, private Storage,
KV, AI and PDF settings. Keep Guardian single-tenant. Resolve paths under the
actual immutable project root and verify none overlap app/system/snapshot,
Storage, build output or other Fabric ownership.

Logging owns **separate audit and operational Fabric database files** under
its private root, with FULL sink durability. Do not point either at the clinical
database or `systemDb`, create a `logs` table in the patient DB, or invent an
organization/tenant to hold logs. Original-source queues are small private
same-transaction evidence queues; they are not the final log store.

The default packaged actor entry starts a supervised delivery subprocess and
Fabric writers/readers. Delivery batching, fair source scheduling and retries
run outside the web process. The app still performs bounded same-transaction
capture and authorized query coordination. Disk/CPU are shared deployment
resources; independent processes do not promise zero performance cost.
Budget storage, memory, process supervision and read concurrency accordingly.

Source apps normally use the default actor. Compiled/shared-entry deployments
must wire `runLoggingActorIfRequested()` before app startup as described in the
[configuration reference](../../backend/logging/configuration.md). Do not launch
the main app in a logging child or inherit all production secrets into workers.

Start with a low-risk synthetic `basic` smoke test; then use the chosen activity
families and `detailed` where view/copy/print observations are desired. Restart
after configuration changes. Retention/holds/export access need an explicit
operator policy; do not substitute a guessed legal retention duration. Defaults
retain data indefinitely, so capacity monitoring and a deliberate policy matter.

## Declare Clinical Coverage

Automatic ReactiveDB capture is not complete semantic clinical auditing. Many
PracticeIQ repositories use raw SQL, which is outside automatic mutation
capture. Inventory actual entry points and declare their evidence explicitly.

| Operation | Integration and required meaning |
| --- | --- |
| Login, account changes, privileged policy changes | Preserve Guardian's existing audit; verify newly supported events reach the logging projection with correct actor/outcome. |
| Reading a chart, note, assessment or document | Perform domain authorization first, then use `zero.logging.read()` around the authorized preparation. Opaque target only; preparation is not proof of human attention. |
| App mutations through ReactiveDB | Use `zero.logging.run()` for live actor attribution and verify same-commit evidence. Rolled-back writes must have no successful mutation event. |
| Raw-SQL domain writes | Add explicit service-stage instrumentation or move the operation through supported tracked APIs where appropriate. `run()` alone does not make arbitrary SQL automatically audited. |
| PDF preparation, file access, download and export | Declare distinct authorized preparation/release outcomes. Keep private object ownership and byte checks; no raw document content in metadata. |
| Letter email, AI generation and workflows | Record attempts, confirmed service/provider outcomes and unknown outcomes separately. Preserve original operation IDs for reconciliation; no automatic resend after uncertainty. |
| Viewing a chart/page | Bind `useLoggingView()` to an opaque entity ID; distinguish visible/active/elapsed intervals and incomplete tails. |
| Copy and print | Use supported observations and explicit app action outcomes. Never read clipboard content or claim a print-dialog close proves physical printing. |
| Log investigation, export, holds/reviews | Use authorized logging APIs and preserve investigation evidence; no raw SQL interface or direct browser access to the log files. |

All sensitive domain authorization remains server-side. Bind background work
to the proper initiating actor/authority where supported; otherwise record a
system actor honestly. Do not fabricate a staff user for a scheduler event or
take actor identity from browser-supplied IDs.

Metadata is denied by default. Any allowlisted fields must remain bounded,
noncontent scalars. Do not record patient names, DOB, addresses, diagnoses,
clinical narrative, note titles, prompts/replies, email bodies, raw URLs,
tokens, passwords or clipboard values. Even opaque IDs/correlations and derived
evidence require private retention and access controls.

## Compose the Investigation UI

Use `LoggingWorkspace` from `@zero/framework/components/logging` or
`@zero/framework/react` on a protected staff administration page. It reuses
DataTable, the standard filter controls, modal manager, ScrollArea and the
existing authenticated client. Do not create another auth/data/logging client
or duplicate the collector in every page.

The existing AppProvider starts one collector per authenticated scope when
enabled. Bind views at meaningful clinical screens with `useLoggingView`;
public marketing should remain outside patient activity collection. Default
read/export/hold/review/manage access requires a platform administrator. If
PracticeIQ later delegates investigation, declare real Guardian permission
codes and explicit assignments, then test server denial as well as UI gating.
Clinical roles do not receive access merely because they can read patients.

The workspace uses server cursor pages and authorized SSE projections. New
arrivals do not blank/reload existing rows or fabricate an exact total; the user
can request a new baseline. Browser observations upload through batched
same-origin HTTPS POST, not SSE. Blocking/offline failures are reported, not
hidden or misclassified as compliance enforcement.

## Logging Acceptance Gate

In synthetic managed-app tests, prove all of the following:

1. Clinical, system, audit and operational files have separate canonical
   ownership; log files stay private and are not served as assets/backups.
2. Dedicated delivery/writer processes exist and retire cleanly. Kill/restart
   the owned delivery process: source evidence recovers without duplicate
   events, lost committed mutations or a main-process delivery fallback.
3. Enabled mutation capture, explicit reads and declared service stages carry
   correct actor, target, outcome and evidence class. Denials, rollbacks and
   uncertain provider attempts do not become success.
4. A noninvestigator cannot query/stream/export evidence; revocation masks
   retained frontend state and invalidates yielding reads.
5. Navigation/view/copy/print behavior has no content capture. Background,
   hidden/suspended tabs and failed final upload remain honestly described.
6. Exercise simultaneous clinical writes, busy log ingestion, investigations,
   login/refresh and private Storage work on representative data/host settings.
   Record app latency and audit lag; do not mask contention with weakened auth
   or unbounded retries/queues. Source backpressure must not silently lose audit.
7. Restart after stop and verify persistence, health and source backlog. Confirm
   failed optional browser upload does not lock staff out under the ordinary
   detailed profile. Strict enforcement is still a separate unshipped gate.

## Related Guides and Next Steps

- [Logging configuration](../../backend/logging/configuration.md),
  [API](../../backend/logging/api.md) and
  [capture coverage](../../backend/logging/events-and-coverage.md) own exact contracts.
- [Browser activity](../../backend/logging/browser.md) explains observation limits.
- [Logging workspace](../../frontend/components/logging.md) describes the shared UI.
- [Remaining logging gates](../../backend/logging/roadmap.md) must stay visible
  in the app's acceptance record rather than being renamed complete compliance.
