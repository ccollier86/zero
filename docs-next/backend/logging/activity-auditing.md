---
id: zero.logging.activity-auditing
type: how-to
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: generic-activity-auditing
maturity: preview
applies_to: ["2.7.0 activity auditing replacement; use the qualified release commit, not version alone"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "06cd2719ddce6680480845ab46f88eec1b1e0c76"
  snapshot: clean
  date: "2026-10-29"
  evidence_level: implementation-verified
---

# Adopt Activity Auditing

[Logging index](./index.md) · [Exact capture coverage](./events-and-coverage.md)

This replacement keeps the private Fabric workers, Guardian authorization,
source outboxes and original signed evidence. It changes what the investigator
sees: a stable, readable activity with expandable original facts and historical
displayed results. It does not migrate business records into logging.

This guide describes the replacement branch. Its existence is not release
qualification: verify the selected archive against the [operations guide](./operations.md).

## Enable Only What The Installation Needs

Omit `logging` or set it to `false` to disable this subsystem entirely. Updating
Zero does not enable it. `basic`, `activity` and `detailed` collection is optional;
only `compliance` requires expiring audit-delivery admission, source durability,
custody and private export owners. Guardian's existing security audit remains
independent of this setting.

Server configuration fragment:

```ts
logging: {
  preset: 'activity',
  pages: { '/app/invoices': 'Invoices', '/app/invoices/[id]': 'Invoice' },
  resources: {
    invoices: {
      label: 'Invoices',
      fields: {
        status: { values: ['draft', 'approved', 'paid'] },
        description: 'omit',
      },
    },
  },
  browser: { observationsPerMinute: 2048, selectionsPerMinute: 512 },
  capture: { clipboard: false, printing: false },
}
```

`activity` and `compliance` include record/list viewing by default. An explicit
`capture.views: false` overrides that. Copy and print are separate opt-ins, not
automatic surveillance implied by compliance. Change fields are redacted by
default. A finite approved vocabulary permits retained before/after values;
`omit` retains neither the name nor its values. Sensitive field names remain
prohibited even in an allowlist. Review values as well as names: an opaque ID
must not secretly be a name, email address or medical narrative.

## Understand The Three Boundaries

1. **Source facts:** an authorized read prepared a result, or a database change
   committed. Source preparation is not proof of display or human attention.
2. **Displayed selection:** the browser committed a native table/detail view.
   It submits positions in an opaque server receipt, never arbitrary record
   identities or contents. The server verifies the original owner and scope.
3. **Activity:** the investigation projection groups only declared correlations
   and sequenced view facts. Similar names/times do not establish a relationship.

Each displayed version retains ordered record IDs and revision references.
Filtering, sorting, pagination and reactive changes can therefore be inspected
without requerying today's data and pretending it was yesterday's result.
Version history contains actual displayed selections, not prefetched results.
Exact empty results are captured too.

Native `/api/data`, generated Resource list/get and request
`zero.data.get/list/find/findPage` prepare receipts after authorization and
source release, then check authority again. Managed Sync snapshots, catch-up,
live changes and canonical default-plane mutation acknowledgments carry read
provenance for the accepted server objects. Optimistic patches do not inherit it.
Sync preparation runs outside the SQLite writer/authority lease; slow sockets
have bounded independent delivery queues.

Native DataTable collection, lazy/server and data-array sources use committed
row models, not every fetched row. Native MasterDetail owns mounted detail
lifetimes. Hidden panes and speculative reads do not become views. Preserve
the released row objects when locally filtering; arbitrary mapped/cloned rows
need an explicit already-authorized custom receipt.

## Instrument Custom Results Without Another Logging System

After domain authorization, a custom server source prepares the exact result:

```ts
const rows = await invoiceService.listAuthorized(criteria);
const auditReceipt = await zero.logging?.prepareResult({
  table: 'invoices', kind: 'list', rows,
  revision: authorizedSnapshotRevision,
  criteria,
});
return { rows, page, auditReceipt: auditReceipt ?? undefined };
```

This is a route/adapter fragment; `invoiceService`, `criteria`, `page` and the
snapshot reference belong to the application. Receipt preparation does not
perform domain authorization. Return it alongside `rows` and `page` from the
stable native DataTable server adapter. Do not remount the table or fabricate
INSERT/UPDATE events to refresh it.

For a custom mounted view use the public React hooks:

```tsx
import { useLoggingResultView, useLoggingRows } from '@zero/framework/react';

// Use one of these in the actual mounted visible component, not both.
useLoggingResultView(auditReceipt, 'invoice-detail');
useLoggingRows(releasedVisibleRows, { identity: 'invoice-results' });
```

`useLoggingRows` derives only positions from released objects. A record detail
passes `{ kind: 'record' }` with exactly one row. `LoggingRowsView` is a wrapper
for animated retained trees; `LoggingDisplayBoundary` masks hidden panes.
Selection requests are not aborted just because a briefly displayed view closes:
the collector retains its original timestamps/order. Scope replacement still
retires old requests and cannot attribute them to the replacement user.

`useLoggingView({ type, id })` remains an explicitly weaker identity-only tool.
It cannot supply historical result membership or a source revision. Doctor
reports known identity-only/custom-adapter patterns for manual review; it does
not discover arbitrary application semantics or certify complete capture.

The hooks return `action()`, which binds explicit copy/print observations to
the active result. Invoke `clipboard.copy.completed` only after the app's copy
operation resolves, or `clipboard.copy.failed` after failure. No clipboard text
is read. `print.requested` and `print.dialog.closed` never assert paper output.
The unbound `useLoggingActivity().action()` remains available for generic
observations, but cannot identify a displayed record by itself.

## Add Readable Application Actions

For example, approval is already a typed `record.updated` change when it updates
an invoice's status through attributed ReactiveDB operations. An installation
can additionally declare the business meaning through the same facade:

```ts
import { defineLoggingAction } from '@zero/framework/logging';

const approved = defineLoggingAction({
  code: 'app.invoice.approved', version: '1', label: 'Approved an invoice',
  family: 'records', values: { status: ['approved'] },
});

await zero.logging?.action(approved, {
  id: approvalEventId, occurredAt: approvalTimeMs, outcome: 'succeeded',
  target: { type: 'table.invoices', id: invoiceId },
  values: { status: 'approved' },
});
```

Define static labels/vocabularies in trusted server code. Stable event identity
and time belong to that stage; exact replay is not permission to repeat the
business side effect. `run()` carries server attribution into source commits;
`read()` declares a semantic preparation; `record()` remains available for
approved scalar metadata. None grants domain access or creates a distributed
transaction. Human initiators and service/system executors remain distinct.

## Investigation And Safe Links

`LoggingWorkspace` defaults audit to `projection: 'activities'`, with standard
20-row pagination and exact rolling totals. Its explicit raw-evidence control
shows retained technical stages. Filter by person (`userId`, including that
person's initiated service work), exact executor (`actorId`), activity, table,
record, changed field, outcome and source-time interval. Historical approved
differences, result versions, observed duration and supporting facts are
inspectable with native dialogs/tables. Failed/unknown/missing facts are never
relabelled succeeded.

An optional `resolveRecordLink(target, { signal })` workspace prop calls an
application-owned domain authorization endpoint and returns a safe relative
`{ href, label? }` or null. Audit-read permission is not permission to open the
current business record. The framework masks retired-scope links and uses its
normal Link without speculative prefetch. A current-record link is not the
historical snapshot; historical IDs/approved values stay separately inspectable.

Routine successful HTTP stages and healthy delivery renewals are not retained
audit activities. HTTP failure/interruption remains evidence. Explicit
`diagnostics.http: true` can retain successful transport stages as technical
evidence, excluded from grouped activities. An idle audit page does not renew
its investigation window by appending a new activity every five minutes.
New criteria admissions in one explicit server investigation window share a
single grouped activity; their original criteria-digest facts remain separately
inspectable. Unrelated sessions, scopes and later windows are not merged by time.

## Bounds, Missing Evidence And Upgrade

- A result contains at most 1001 records and 256 KiB of manifest data. Page or
  otherwise bound displayed native selections. A known released display over
  that budget reports capture failure, not a falsely complete truncated list.
- Browser observations and result selections have independent per-session/scope
  budgets (2048 observations/512 selections per minute by default, each configurable
  1–10000). The observation budget accounts for both an interval and a result-change
  fact per displayed revision, plus owned-view heartbeats. The collector holds
  128 observations, submits at most 32 per batch and bounds receipt resolution
  to 15 seconds. Overload is visible, not silent sampling.
- First receipt display admission expires after five minutes. A previously
  admitted same-collector view and exact committed replay have separate rules.
  A retained receipt is not authority to access the original business record.
- Observed foreground/active time is not proof of attention. Hidden/idle time,
  sleep gaps, abrupt closes and incomplete intervals remain distinguishable.
- Raw v1 evidence exports remain compatible. Activity v2 exports include
  bounded historical results, source lineage and supporting evidence. Query
  completeness and history completeness are separate; inspect both flags and
  continuation/unavailable markers. See [evidence exports](./evidence.md).
- Additive private realm migrations retain old envelopes, identities, proofs,
  holds and custody. Restartable 100-event batches reconstruct the projection;
  startup waits for that reconstruction before publishing it. A large retained
  trail needs an explicitly measured startup window. Retired data is not rebuilt.

No default retention cutoff or backup/archive-import service is added. Follow
the [retained-state upgrade procedure](./operations.md), preserve recovery
artifacts and test the exact installed archive in the application's deployment
shape. Neither this guide nor `complianceReady` is legal certification or proof
of application-specific clinical capture.
