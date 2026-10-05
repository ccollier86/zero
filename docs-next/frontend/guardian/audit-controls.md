---
id: zero.frontend.guardian.audit-controls
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: audit-ui-and-data-readiness
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Audit Viewer And Application-Data Readiness Controls

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

These controls present durable control-plane history and application-data
readiness. They solve different problems: audit is authorized history; readiness
is a provisioned/migrated/projected data-plane barrier, not a permission grant.

## ControlPlaneAuditViewer

Import from `@zero/framework/components/auth`.
Props: required `scope: 'platform' | 'tenant'`, optional `className`,
`pageSize` (50, bounded1–100), `title` (Authorization audit),
`description` (retained security/access changes).

The viewer supplies action/target-type/outcome filters, cursor loading, safe
failure/denial handling and NDJSON export of the accepted query.
Platform versus tenant is an explicit server-authorized read scope. Choosing
platform in a prop does not make an ordinary user able to read it.
Retention/export bounds are owned by [backend audit](../../backend/guardian/audit.md).

```tsx
import { ControlPlaneAuditViewer } from '@zero/framework/components/auth';

export function OrganizationHistory() {
  return <ControlPlaneAuditViewer scope="tenant" pageSize={50} />;
}
```

## useAuthAudit

Import from `@zero/framework/react/hooks`.
Options extend `AuthAuditQuery` without cursor and require `scope`, with
optional `enabled`. Filters include action/outcome/time range/target.

Result: readonly `events`, `page`, `isLoading/isLoadingMore/isExporting`,
`isDenied`, `error`, `reload()`, `loadMore(): Promise<void>`,
`exportEvents(limit?): Promise<AuthAuditExport>`.

The hook fences identity/current-tenant query and export results and deduplicates
loaded event IDs. A tenant transition retires the prior read. NDJSON downloads
can contain sensitive operational identifiers; app placement/download policy
must reflect authorized audience, not broad anonymous sharing.

## DataRealmReadyGate

Import from `@zero/framework/components/auth`.
`DataRealmReadyGateProps` includes children, `enabled?`, `pollIntervalMs?`,
optional controlled `readiness`, `renderFallback(readiness)?`, `className?`.
Passing controlled readiness suppresses the internal query.

Ready renders children; disabled renders null. Other states render the custom
fallback or `DataRealmReadinessNotice`. Children are not mounted while the
realm is pending, so they need not attempt application queries against a
not-yet-projected user anchor or not-yet-migrated tenant database.

It does not enable Fabric, create a tenant, replace server readiness admission
or authorize a table. The readiness SDK/hook remains owned by the shared SDK
family, not an alternate Guardian implementation.

## DataRealmReadinessNotice

Props require a readiness control, with optional `title`, `description`,
`retryLabel`, `className`.
The notice renders pending status/live/busy semantics, or an error alert and
Retry only when the returned control reports retry is available. Retry delegates
to the current readiness hook/controller; do not manually create database files
or synthetic user anchors from the browser.

## Verification And Related Guides

Test audit denial/export/cursor/query changes and a pending-to-ready data realm,
including error/retry and organization switching. A provision failure must not
look like an empty successful application table.

- [Backend audit](../../backend/guardian/audit.md) owns event/privacy/retention contracts.
- [Identity projection](../../backend/guardian/identity-projection.md) explains readiness and shallow FK anchors.
- [Frontend SDK](../sdk/index.md) owns scoped service facades and readiness transport.
