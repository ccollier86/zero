---
id: zero.guides.practiceiq-upgrade.logging
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: in-review
visibility: internal
system: logging
feature: practiceiq-logging-rollout
maturity: supported
applies_to: ["2.6.0 builds with managed compliance logging and native live audit tables"]
modes: [single-tenant, Fabric-logging]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7e0ba2814b2526fe997282d21d298ed2c87be90c"
  snapshot: clean
  date: "2026-10-26"
  evidence_level: implementation-verified
---

# Integrate PracticeIQ Logging Deliberately

[PracticeIQ upgrade](./index.md) · [Documentation index](../../index.md)

Enable logging only after the isolated data conversion and ordinary app
authorization pass. Logging is core but optional; updating Zero alone creates
no new log files, workers or browser collection. PracticeIQ requires the actual
`preset: 'compliance'`, not a `detailed` substitution or disabled audit.
The managed completion release implements it with strict source/admission/
custody/export checks. Select the final qualified normal main archive before
application acceptance, verifying its source commit and checksum.

## Configure Separate Storage

This is a typed **configuration fragment**, not a replacement for PracticeIQ's
full config or a command to execute against current data:

```ts
import type { AppConfig } from '@zero/framework/server';

export const upgradedPlanes = {
  db: { mode: 'file', path: './data/application.db', synchronous: 'FULL' },
  systemDb: { mode: 'file', path: './data/zero.system.db', synchronous: 'FULL' },
  databaseTopology: { mode: 'single' },
  logging: {
    rootDirectory: './data/zero.logs',
    preset: 'compliance',
    minimumLevel: 'info',
    metadataKeys: ['operation', 'documentKind', 'rowCount'],
    retention: { auditDays: null, operationalDays: null },
  },
} satisfies Pick<AppConfig, 'db' | 'systemDb' | 'databaseTopology' | 'logging'>;
```

Merge reviewed slices into the actual typed app config, retaining its app DB,
auth/MFA, trusted properties, route/resource/Sync policy, email, private Storage,
KV, AI and PDF settings. Keep Guardian single-tenant. Resolve paths under the
actual immutable project root and verify none overlap app/system/snapshot,
Storage, build output or other Fabric ownership.

Preserve PracticeIQ's actual application/system file paths; the example names
are not permission to create an empty replacement or switch a live hot image
without its approved migration boundary. Both sources must explicitly use
`FULL`/`EXTRA`; the ordinary `NORMAL` default is not strict-qualified.
Guardian remains single-tenant.

Logging owns **separate audit and operational Fabric database files**, plus
a third private signed-checkpoint file for built-in local custody, under
its private root with FULL sink durability. Do not point any at the clinical
database or `systemDb`, create a `logs` table in the patient DB, or invent an
organization/tenant to hold logs. Original-source queues are small private
same-transaction evidence queues; they are not the final log store.

The default packaged actor entry starts a supervised delivery subprocess and
Fabric writers/readers. Delivery batching, fair source scheduling and retries
run outside the web process. The app still performs bounded same-transaction
capture and authorized query coordination. Disk/CPU are shared deployment
resources; independent processes do not promise zero performance cost.
Budget storage, memory, process supervision and read concurrency accordingly.

PracticeIQ's bundled `dist/server.js` with retained source/dependencies uses an
explicit source entry and empty environment:

```ts
// server/logging/actor-entry.ts
import { runLoggingActorIfRequested } from '@zero/framework/server';

if (!await runLoggingActorIfRequested()) process.exit(64);
```

Set `logging.actors.launch` to `{ kind: 'source', entrypoint: actorEntry }`
using the resolved retained entry, and `logging.actors.env` to `{}`.
Build with the official Zero command so canonical logging migration identities
match between bundle and actors. The linux/amd64 fixture qualifies that shape;
the app agent must repeat it in PracticeIQ's actual image. Other shared-entry
forms follow the [configuration reference](../../backend/logging/configuration.md).
Never import the main server in a logging child or inherit provider/dotenv secrets.

Use compliance in its isolated acceptance environment. A synthetic lower-preset
smoke test can help diagnosis but is not PracticeIQ's release configuration.
Restart after configuration changes. Retention/holds/export access need an explicit
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

The workspace uses server cursor pages and authorized reactive append delivery.
Small visual batches feed DataTable's existing live-insertion animations and
incoming-record control. No separate logging reveal button, table remount,
whole-table blank/reload or fabricated exact total is involved.
Browser observations upload through batched
same-origin HTTPS POST, not SSE. Blocking/offline failures are reported.
Under compliance, expired or interrupted delivery masks protected UI and blocks
protected HTTP/Sync until a fresh durable acknowledgment; sign-in, health,
handshake and same-origin empty recovery remain reachable. This neither
identifies a particular extension nor proves the browser reported every action.

### Generated-route browser acceptance

Rebuild the browser assets after installing the pinned correction; do not reuse
an older generated bundle merely because the package version still says 2.6.0.
Keep the normal root AppProvider and native LoginForm without a duplicate
navigation-only `onSuccess`. The framework now keeps session recovery alive
while audit delivery masks its output. No app-local auth/logging workaround or
new provider prop is required.

Repeat the application's fresh unblocked sign-in and initially blocked audit
delivery fixture modes. Verify native audit/session retries, protected SSR hard
refresh, a real new tab sharing the existing browser session, and bounded reload
behavior. A separate profile with a copied page cookie but no browser proof is
not that new-tab case and must not be promoted into API authentication.
Successful HTTP statuses alone do not satisfy the gate. After reaching the
workspace, exercise real SSE inserts/bursts, retained rows, cursor pagination
and the native incoming-record control, actor/resource filters, evidence
dialogs and current-role revocation masking. Keep patient state and real
provider effects absent from the fixture; live cutover remains separately
authorized. The independent email-delivery receipt migration is not part of
this browser lifecycle fix.

### Container startup after source setup

PracticeIQ's setup/provisioning and migration commands can run the framework
from source before `dist/server.js` opens the same system database. Use an
archive containing the canonical **core as well as logging** build correction,
and rebuild with `zero build`; otherwise Bun's function formatting can falsely
trip the unchanged-migration checksum check. No numbered migration, checksum
ledger rewrite or re-conversion is part of this build correction.

Qualify the actual container sequence against disposable source-prepared state,
preserving original identities/history and private logging files. Require both
source setup and compiled startup/restart to pass, not only an empty logging
worker smoke test. Genuine history mismatches stay blocked. The separate
email-delivery receipt migration still requires its own reviewed decision.

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
7. Restart after stop and verify persistence, health, source backlog and signed
   checkpoints. Test an unavailable source, disk-full rollback and loss of the
   delivery worker: no old strict grant may silently become valid after recovery.
8. Block observations, expire admission, reconnect, switch/revoke scope and hard
   refresh. Verify fail-closed protected UI/SSR/HTTP/Sync with reachable recovery
   and no session-restoration deadlock. Test nonadministrator logging denial too.
9. Request a private export, restart during its lifecycle, then reauthorize its
   download. Verify exact retained bytes/hash, expiration and cleanup retry.
   A lost acknowledgment retains the same job/event identity, not a duplicate send.
10. Validate the agreed native DataTable, user/activity filters and live insertion
    behavior. Richer saved Filters/evidence-management UI remain optional future work.

## Related Guides and Next Steps

- [Logging configuration](../../backend/logging/configuration.md),
  [API](../../backend/logging/api.md) and
  [capture coverage](../../backend/logging/events-and-coverage.md) own exact contracts.
- [Browser activity](../../backend/logging/browser.md) explains observation limits.
- [Logging workspace](../../frontend/components/logging.md) describes the shared UI.
- [Remaining work](../../backend/logging/roadmap.md) distinguishes UI/deferred
  features from the app's mandatory acceptance and qualified archive boundary.
