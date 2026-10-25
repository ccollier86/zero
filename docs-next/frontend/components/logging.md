---
id: zero.frontend.components.logging
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: draft
visibility: internal
system: logging
feature: logging-workspace
maturity: preview
applies_to: ["Unreleased logging/AI completion branch based on 2.6.0"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "fc61dcc4cd107c6467bff498d3a772e8f5bdea9d"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
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

Props are `className`, `defaultStream` (`audit` by default),
`initialQuery`, `allowExport` (true), and `scope` (`current` by
default, or `platform`). Platform mode uses the separately authorized
cross-tenant/control-plane read and does not expose the current-scope export
button as if it exported the platform result. Props never grant server authority.

## Reading and Live Updates

The table reads server-filtered cursor pages, newest ingestion ordinal first.
It does not download the full dataset for filtering or fabricate an exact total.
Page size defaults to 25. Dates display source times in the browser locale;
the evidence dialog separately shows ingestion time and source position.

Family and outcome remain compact. More filters opens a standard morphing
Popover with actor, exact action, resource and date constraints; overflowing
content uses the shared ScrollArea treatment. All criteria combine with AND.
Advanced nested/saved filter-builder behavior is still planned, not decorative
controls pretending to execute on the server.

A committed SSE projection signals newer activity. Existing table rows and the
reading baseline stay in place; a “New activity available” action explicitly
starts a fresh snapshot. The UI does not call an ordinal difference an exact
new-row count. Pagination uses DataTable's directional page motion, not a
new component for each page.

Scope replacement masks old rows and evidence immediately. Stream failure or
failed revalidation hides protected evidence until a fresh authorized snapshot
succeeds. Filters stay in local state, not URLs or analytics. Export failures
are shown safely without raw exceptions/provider data.

## Reusable Parts

- `LoggingFilters({ value, onApply })` owns the closed server filter criteria.
- `LoggingEventDetail({ stored, scopeKey })` renders safe metadata and evidence
  meaning, in a bounded ScrollArea. It refuses to render outside its captured
  ready scope. The workspace opens it through the managed modal API.
- `createLoggingTableSource(client.logging, stream, query)` provides a stable
  server DataTable adapter; reconstruct it only for a new explicit baseline.
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
dialog focus management. The standard components provide compact light/dark,
touch, narrow-layout and reduced-motion behavior. Long IDs wrap in detail;
there is no HTML execution or raw provider payload dump.

The workspace is an investigation interface, not a green compliance badge.
Browser copy/print/view signals remain observations. Review/hold/integrity
services have typed APIs but do not yet have a full management organism.
The completion branch adds strict required-browser-delivery gating through
AppProvider and the managed server; ordinary lower presets stay optional.
Durable exports retain their request ID across pending/uncertain states so
checking a job does not create a second export. A fuller dashboard review and
evidence-management UI will be planned with the user before application handoff.

## Related Guides and Next Steps

- [Logging configuration](../../backend/logging/configuration.md) covers enablement and permissions.
- [Server and client API](../../backend/logging/api.md) covers query/stream contracts.
- [Browser collection](../../backend/logging/browser.md) defines signal semantics and strict delivery requirements.
- [Evidence lifecycle](../../backend/logging/evidence.md) covers exports, holds, reviews and integrity.
- [DataTable](../data-controls/data-table/index.md) owns underlying server pagination and row presentation.
