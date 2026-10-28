---
id: zero.frontend.components.logging
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: logging-workspace
maturity: supported
applies_to: ["2.6.0 source builds containing the people-first LoggingWorkspace directory and presentation APIs"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1849e34ae7a36fbfaa07ea05aa946ae38a1b347c"
  snapshot: clean
  date: "2026-10-28"
  evidence_level: implementation-verified
---

# Logging Workspace and Activity Hooks

[Component index](./index.md) · [Frontend index](../index.md)

`LoggingWorkspace` is the self-wired investigation organism. It reuses the
existing authenticated SDK, DataTable cursor adapter, Morph Select, Popover,
ScrollArea, managed ModalManager and design tokens. It does not introduce a
second table, auth client, database connection or analytics script.

## Composition

```tsx
import { LoggingWorkspace } from '@zero/framework/react';

export default function LogsPage() {
  return <LoggingWorkspace defaultStream="audit" />;
}
```

Use the existing configured AppProvider and app styles. Backend logging and
Guardian must be enabled. The component can supply a ModalManager host when
none exists; the normal AppProvider already supplies one.

For an investigator's user-specific view, pass
`initialQuery={{ actorId: selectedUserId }}`. The existing user/action/resource/
date/outcome filters run on the server and apply to live arrivals as well as
pages. This is an initial filter, not permission for a user to view audit logs
or a server-enforced self-only access policy; Guardian still authorizes reads.

Props are `className`, `presentation` (optional app-authored labels), `defaultStream` (`audit` by default),
`initialQuery`, `allowExport` (true), and `scope` (`current` by
default, or `platform`). Platform mode uses the separately authorized
cross-tenant/control-plane read and does not expose the current-scope export
button as if it exported the platform result. Props never grant server authority.

## Reading and Live Updates

The table reads server-filtered cursor pages, newest ingestion ordinal first.
It does not download the full dataset for filtering or fabricate an exact total.
Page size defaults to 25. Dates display source times in the browser locale;
the evidence dialog separately shows ingestion time and source position.

The compact Audit activity / Diagnostics tabs use the shared magnetic selection
highlight. The header reports the live connection state, not audit integrity or
compliance health. No ornamental global totals or success-rate cards infer
completion from the currently loaded page.

The first-line controls are **User**, **Activity**, **Table**, and **Outcome**.
User searches the authorized Guardian directory, not only names present on the
loaded page. Creating, editing and deleting records use actual retained actions
(`record.created`, `record.updated`, `record.deleted`); the table picker uses
the exact retained `table.*` target, not a client-side text filter.

More filters opens a standard morphing Popover with category, user/session IDs,
exact activity code, resource type/record ID, severity and source-time
constraints; overflowing content uses the shared ScrollArea treatment.
All criteria combine with AND. Draft choices do not change the investigation
until Apply filters. Applied criteria have individually
removable chips. Invalid codes and reversed date ranges produce local feedback
without issuing an invalid page query; server validation remains authoritative.
Times are interpreted in the investigator's local timezone and the end time is
exclusive. No free-text clinical or message-content search is exposed.

Clear filters removes these editable criteria, not a caller-supplied `eventIds`,
`beforeOrdinal` or `highWaterOrdinal` investigation restriction. Those restrictions
are explained visibly. Neither `initialQuery` nor its chips constitute an
authorization policy; a mandatory self-only boundary belongs on the server.
Advanced nested/saved filter-builder behavior is still planned, not decorative
controls pretending to execute on the server.

The private Fabric/ReactiveDB append sequence drives an authorized SSE cursor
into DataTable's standard server-source subscription. Genuine INSERT identities
are batched for roughly 250 ms, then the table performs one page refresh and
uses its existing insertion/highlight motion. Retained rows stay mounted; live
arrivals do not replay the initial loading animation or blank the table.

On an older page or while interacting with the table, its existing incoming-record
control owns the count and return-to-start behavior. There is no separate logging
“New activity available” button. Cursor pages remain stable by ingestion ordinal;
an ordinal difference is not treated as an exact filtered count. Visual INSERT
evidence is bounded to the latest 1000 pending identities, not an unbounded browser
copy of the audit trail. This limit does not drop durable log events.

Page/cursor/membership lookups share the audited investigation window rather
than recursively creating audit entries for their own live refreshes. Every
read still uses current Guardian authorization and strict delivery admission.

Scope replacement masks old rows and evidence immediately. Stream failure or
failed revalidation hides protected evidence until a fresh authorized snapshot
succeeds. Filters stay in local state, not URLs or analytics. Export failures
are shown safely without raw exceptions/provider data.

## People and readable activity

The main table shows **When / Who / Activity / Table or resource / Result**,
with a separate evidence-source column. Human entries show the current name,
username and authorized private avatar. Repeated rows share photo reads; scope
retirement masks and releases the old image URLs. No public avatar permission
or image URL is created just for the logs. Disabled, absent or inaccessible
photos fall back to initials; an unavailable/deleted/out-of-scope user has a
neutral placeholder and its exact retained identity remains in the details.

Service/API-key, system and anonymous activity have their own labels. They
are never presented as a signed-in person, and the logs do not invent a
historical presence indicator. Current profile presentation is **not** a
historical name/photo snapshot and is not inserted into immutable evidence,
signatures or exports.

Common operations have built-in plain-language labels. Apps can translate their
own stable actions and table names through `presentation` without rewriting
events or creating a private logging UI:

```tsx
import { LoggingWorkspace, type LoggingPresentation } from '@zero/framework/react';

const language = {
  actions: {
    'clinical.plan.reviewed': {
      label: 'Reviewed a treatment plan',
      description: 'The application recorded its authorized review stage.',
    },
  },
  tables: { treatment_plans: 'Treatment plans' },
  resources: { document: 'Document' },
} satisfies LoggingPresentation;

export default function AuditPage() {
  return <LoggingWorkspace defaultStream="audit" presentation={language} />;
}
```

`actions` keys are exact action codes. `tables` keys are declared table names or
exact retained types such as `table.treatment-plans`; `resources` keys are exact
non-table target types. Labels/descriptions are plain React text, not HTML or
format strings that interpolate record contents. Overrides change presentation
only: selecting a friendly activity/table still sends the original exact code.
Do not use a label that claims human viewing, final provider delivery, or
workflow success when the named stage establishes only preparation/acceptance.

The table catalog uses registered app/resource schemas, not a scan of private
database files. Tenant viewers receive only declared tenant table names. Old,
removed or custom/unregistered targets can still be investigated by exact type
in More filters, and exact retained types can have display overrides. Existing
normalization can map two raw table names to the same retained type; they are
grouped together, not falsely offered as distinguishable filters. No migration
or evidence rewrite is required for these presentation additions.

## Reusable Parts

- `LoggingFilters({ value, onApply, tables?, presentation?, selectedPerson?, onPersonChange? })`
  owns the closed server filter criteria. The workspace supplies its scoped
  catalog and selected current profile automatically.
- `LoggingEventDetail({ stored, scopeKey, person?, tables?, presentation? })` renders safe metadata and evidence
  meaning, in a bounded ScrollArea. It refuses to render outside its captured
  ready scope. The workspace opens it through the managed modal API.
- `createLoggingTableSource(client.logging, stream, query)` provides the standard
  live server DataTable adapter, exact filtered membership and newest-row proof.
  Keep it stable across updates and page changes. Its `watchStatus()` shares
  the same connection so recovery remains active while evidence is masked.
- `useLoggingEvents(stream, query)` returns `page`, `error`,
  `isLoading`, and `refresh` with cancellation and synchronous scope masking.
- `LoggingActivityProvider` is automatically mounted by the configured
  AppProvider; manual composition must not duplicate it.
- `useLoggingView(target)` binds one opaque page/document target.
- `useLoggingActivity()` exposes the collector and explicit observation action.
- `createLoggingCollector()` supplies headless lifecycle-owned collection.

Headless contracts come from `@zero/framework/logging`. The component family
also has `@zero/framework/components/logging`. Server modules, SQLite and
Fabric are not part of either browser import graph.

## Accessibility and Evidence Limits

Use normal keyboard table navigation, labelled filter controls and shared
dialog focus management. Each row also has an explicit Inspect event button.
The modern managed evidence dialog morphs from that initiating control (or the
native row), and groups outcome, evidence meaning, source/ingestion times,
current person/resource presentation, provenance and allowed metadata. Exact
action codes, user/service/session/record IDs and allowed metadata live in the
collapsed **Technical details** section, using Zero's keyboard-accessible
Collapsible. Missing values are
labelled Not recorded, not silently inferred. The standard components provide compact light/dark,
touch, narrow-layout and reduced-motion behavior. Long IDs wrap in detail;
there is no HTML execution or raw provider payload dump. Narrow screens retain
readable columns inside the shared horizontal ScrollArea without widening the
page; scrollbar chrome remains hidden by default. Stream recovery keeps its
subscription alive while protected rows are masked. A successful fresh read
restores the table; normal reconnection is never represented as missing logs.

The workspace is an investigation interface, not a green compliance badge.
Browser copy/print/view signals remain observations. Review/hold/integrity
services have typed APIs but do not yet have a full management organism.
Managed compliance adds strict required-browser-delivery gating through
AppProvider and the managed server; ordinary lower presets stay optional.
Durable exports retain their request ID across pending/uncertain states so
checking a job does not create a second export. A fuller dashboard review and
evidence-management UI are optional future work, not prerequisites for the
agreed DataTable/filter/live-update/individual-user view.

## Related Guides and Next Steps

- [Logging configuration](../../backend/logging/configuration.md) covers enablement and permissions.
- [Server and client API](../../backend/logging/api.md) covers query/stream contracts.
- [Browser collection](../../backend/logging/browser.md) defines signal semantics and strict delivery requirements.
- [Evidence lifecycle](../../backend/logging/evidence.md) covers exports, holds, reviews and integrity.
- [Investigation UI repair and qualification](../../_work/logging-workspace-polish.md) records the current branch's scope and evidence.
- [DataTable](../data-controls/data-table/index.md) owns underlying server pagination and row presentation.
