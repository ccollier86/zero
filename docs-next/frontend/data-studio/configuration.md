---
id: zero.frontend.data-studio.configuration
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio UI Configuration

[Data Studio index](./index.md) · [Documentation index](../../index.md)

The connected UI requires the managed Data Studio service configured on the server,
a signed-in admitted organization and the normal client/provider. React props
cannot enable a disabled service or override live permissions. Scope selection is
server/Guardian-owned, not an arbitrary organization ID prop.

The service requires [multi-tenant advanced RBAC and Fabric tenant databases](../../backend/data-studio/profiles.md),
with the complete official feature bundle from [installation](../../backend/data-studio/installation.md).
Its [backend configuration](../../backend/data-studio/configuration.md) owns fragment
composition and hard limits, not UI props.

DataStudioProps extends UseDataStudioOptions: enabled, initialTableId, tableStatus,
pageSize, rowLoading, initialSearch and initialFilters. It adds capabilities, title,
description, className, emptyState, detailsOpen, defaultDetailsOpen,
onDetailsOpenChange and resizableDetails. enabled defaults true; false leaves the
controller idle. initialTableId defaults null, tableStatus active, search empty,
filters empty and requested pageSize50 (clamped to server maximum).
initialSearch/initialFilters/initialTableId initialize query state, not a persisted
saved view. tableStatus follows later prop changes; pageSize is rederived and
clamped by server capabilities.

`DataStudio` defaults rowLoading to `'progressive'`; `useDataStudio` retains
`'paged'` as its standalone compatibility default. Progressive Studio reads
bounded batches and has no page controls; the general DataTable and paged hook
keep their pagination contracts. The optional desktop inspector starts hidden;
set defaultDetailsOpen true, or control detailsOpen/onDetailsOpenChange.
resizableDetails defaults true. Mobile record inspection is independent of
desktop visibility and provides a Back to records action.

capabilities is Partial<DataStudioAccess> (canRead/canWrite/canManage). false narrows
a server permission; true cannot widen it. DataStudioWorkspace defaults title
"Data Studio" and description "Create tables and edit your workspace’s records."
It accepts controller plus those presentation/narrowing props.
Neither organism takes raw SQL, an actor handle or a browser tenant selector.

The focused components have controlled props documented in their own pages.
Their busy/disabled flags are presentation inputs and must reflect actual controller
state. Backend limits, schema admission, permissions, revisions, operation IDs
and database lifecycle remain server contracts.

Settings are read at React/controller composition, not from environment variables.
Doctor may validate trusted app/server configuration but does not simulate these
browser interactions. Enabling the UI is not a schema migration or data-plane split.

## Related Guides And Next Steps

- [Workspace](./workspace.md) is the complete UI.
- [Controller](./controller.md) owns source state and accepted operations.
- [SDK](./sdk.md) owns HTTP/errors/retry identity.
- [Guardian authorization](../../backend/guardian/authorization.md) owns authority.
