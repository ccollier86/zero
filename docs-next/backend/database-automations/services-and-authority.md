---
id: zero.database-automations.services-and-authority
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: services-and-authority
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Source-Bound Services And Authority

[Database automations](./index.md) · [Runtime machine services](../runtime/machine-services.md) · [Documentation index](../../index.md)

A durable automation executes trusted system code attributed to its admitted
source. It does not impersonate the browser user who last changed the row or
fabricate a human session. A source catalog carries the application/tenant
binding; current eligibility and execution lifetime govern every scoped call.

## Public Context

DatabaseAutomationExecutionServerServices is exported from
@zero/framework/server. It extends AuthorityScopedServerServices with the
narrow torrent.deliverEvent helper.

| Member | Meaning |
| --- | --- |
| access, scope | Sealed system access and immutable physical data scope. |
| data | Tenant-file AsyncDatabaseClient when tenant-database isolation applies; otherwise null. |
| auth | Guardian authorization compiler/kernel subset, not raw user stores/tokens. |
| storage | Scope-closed storage facade, or null when unavailable. |
| notifications, rooms | Scoped domain facades, or null. |
| workflows | Scope-closed workflow facade, or null. |
| pdf | Scope-closed PDF facade, or null. |
| observability | Scope-attributed emitters, not raw global sink/store. |
| torrent | Exact system event helper with delivery-derived idempotency. |

The strict projection deliberately does not expose unsafe, raw db/sql/sqlite,
system databases, global registry/manager, KV/counters/limiter, vector, raw AI
or email. Do not document context.zero.ai or context.zero.email as available.
A trusted registered handler may close over a separately app-owned adapter,
but its authorization, accounting, scope, cancellation and external idempotency
remain application responsibilities. Such capture is not an implicit expansion
of the supplied capability.

## Admission And Live Fences

Managed composition derives a privileged system ServiceDataScope from trusted
catalog authority, not an untrusted tenant selector. Tenant sources are bound
to the catalog's tenant. Application sources remain application-bound.
An automation cannot select another organization's file through its data client.

Synchronous fences run before scoped reads/mutations; async fences run around
operations that yield. Before the handler and before completion, the provider
revalidates source state and eligibility. Closing the execution lease or aborting
its signal revokes its service lifetime. Current suspended/unavailable source
state is not bypassed because an old command exists.

This is system provenance, not canonical Guardian membership. An ID-only
user anchor is referential existence, never live authority.
[Transaction functions](./transaction-functions.md#guardian-anchors) explains
pinned versus Fabric anchor protection.

## Origin Policy Still Matters

Authorize the originating API/webhook/Resource mutation before writing a row.
The automation itself is trusted business behavior triggered by an admitted
change. It must not be installed as a generic way for anonymous input to call
privileged system actions.

Store exact correlation from trusted server data. Never accept a webhook's
arbitrary workflow ID and assume source binding makes the webhook authentic.
A correct scope fence limits the destination; it does not validate the external
sender.

## Failure And Integration

Authority lost during execution fails safely; service results cannot preserve a
revoked lease. Torrent commit fences map changed authority to
WORKFLOW_AUTHORITY_CHANGED. Missing Torrent is
DATABASE_OPERATION_UNSUPPORTED, retryable and not-started for this helper.

Use the public types and managed provider; don't fabricate internal source
records in app code or import private files to reach raw handles.
[Runtime services](../runtime/server-services.md) describes request/machine
boundaries and [delivery](./delivery.md) describes recovery.
