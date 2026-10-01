# Durable Authorization And Control-Plane Audit

> Status: implemented in this unreleased candidate
>
> Last reviewed: 2026-10-01

Zero retains a bounded, append-only trail for security and authorization
control-plane changes. This is not a general user-activity logger: it does not
record page views, ordinary data reads, arbitrary request bodies, application
CRUD, file contents, login telemetry, or browser-idle sessions.

The trail is enabled whenever Auth is enabled. Configuration controls retention
work, not whether successful security mutations are recorded:

```ts
auth: {
  audit: {
    retentionDays: 365,   // 1..3650
    pruneBatchSize: 1000, // 1..10000 per SQLite transaction
    pruneInterval: '6h',  // 1m..7d
  },
}
```

Omitting `audit` uses those defaults. Invalid or unknown fields fail config
normalization and are reported by Doctor as an invalid platform config.

## Storage and durability

Migration `018` creates `_auth_audit_events` and the internal retention gate.
Both tables are `_`-prefixed server-private tables and are never published
through Sync. Event rows cannot be updated. A SQLite trigger rejects deletion
unless the retention gate is enabled in the same transaction and the row is
older than the configured cutoff.

Successful control-plane writes append their event inside the same
`ReactiveDB`/SQLite transaction wherever the state mutation is local. If event
validation or persistence fails, that protected mutation rolls back. This is
the important guarantee: a committed role, membership, ownership, session,
password, MFA, verification, or domain-control change is not followed by a
misleading after-the-fact attempt to record it.

Email/provider delivery and DNS resolution happen outside SQLite by necessity.
Admin setup/reset delivery records separate prepared, provider-succeeded, and
provider-failed facts, but never claims those external facts committed
atomically with SQLite. Other provider/DNS attempts remain operational
observability under the
[Auth Operational Failure Contract](../observability.md#auth-operational-failure-contract).
The resulting local security-state transition—for example the
password-change gate after successful setup delivery or the finalized domain
verification result—is still written atomically with its own mutation.

## Event contract and data minimization

Every event contains:

- an opaque event ID and millisecond timestamp;
- a bounded action code, `succeeded | denied | failed` outcome, and optional
  bounded reason code;
- exactly one application or tenant scope;
- available actor user, membership, session, session kind, native client, and
  one bounded provenance value;
- safe request/correlation IDs when the corresponding headers contain only an
  acceptable opaque identifier;
- an optional bounded target type/ID;
- at most 16 scalar metadata fields in at most 2 KiB of JSON.

The writer rejects secret-bearing metadata keys, including password, token,
credential, authorization, cookie, and similar names. Metadata strings are
bounded and values containing `@` are rejected so raw email addresses are not
stored by default. Passwords, access/refresh/action tokens, MFA codes or
secrets, authorization headers, cookies, request bodies, names, addresses,
phone numbers, and arbitrary payloads are never part of this contract.

The event projection returned to browsers is intentionally the same bounded,
secret-free shape. The browser transport validates response shape, counts,
cursor consistency, identifiers, metadata bounds, and NDJSON records instead
of blindly trusting a successful response.

## Covered mutations

The current trail records these successful local control-plane transitions:

| Area | Action families |
| --- | --- |
| Installation and identity | `application.bootstrap-completed`, `application.auth-profile-adopted`, `tenant.administration-adopted`, `identity.registered`, `identity.provisioned-by-admin`, `identity.provisioning-rolled-back`, `identity.provisioning-reconciled` |
| Application access | `application.roles-replaced`, `application.ownership-transferred`, `application.ownership-adopted`, `application.tenant-owner-roles-reconciled`, `application.authorization-registry-initialized`, `application.authorization-registry-updated` |
| Tenant lifecycle and authority | `tenant.created`, `tenant.member-added`, `tenant.member-updated`, `tenant.member-removed`, `tenant.ownership-transferred`, `application.tenant-created`, `application.tenant-suspended`, `application.tenant-reactivated` |
| Invitations and requests | `tenant.invitation-issued`, `tenant.invitation-revoked`, `tenant.invitation-accepted`, `tenant.join-request-submitted`, `tenant.join-request-approved`, `tenant.join-request-denied` |
| Session scope and revocation | browser and native `session.scope-switched`, `session.tenant-selected`, `session.tenant-switched`, `session.revoked`, `session.user-scope-revoked`, and `account.sessions-revoked` |
| Account security | password change/recovery/admin reset and forced-change gates; admin setup/reset delivery prepared/succeeded/failed; email verification; admin account update/status/delete; admin property writes; MFA enrollment, requirement, clear, and reset |
| Verified domains | claim creation/release, challenge issuance, manual verification finalization, and policy update |
| Trail access | successful and authenticated denied `audit.exported`; successful operator `audit.retention-pruned` |

Administration Organization cross-workspace member/role/ownership mutations
reuse the tenant action families above. Their tenant scope identifies the
customer target while the actor fields identify the real platform operator;
the adapter does not create a second audit vocabulary or impersonate a
customer member.

No-op role/status/security requests that successfully pass policy may retain an
event with `metadata.changed: false`. A failed domain proof is retained as a
completed verification action with outcome `failed` and reason
`proof-mismatch`. The platform-user deletion conflict caused by retained
tenant history is retained as denied without deleting the identity.

Administrator setup compensation records `identity.provisioning-rolled-back`
when the exact untouched identity is removed. Its reason distinguishes a
provider rejection (`setup-delivery-failed`) from a receipt, token-binding, or
final state-commit failure (`provisioning-failed`). If concurrent authorized
work has adopted that identity, Zero instead records
`identity.provisioning-reconciled` with reason `newer-state-preserved`; the
setup token and stale receipt are retired while the account remains. Crash
recovery writes the same durable distinction in the recovery transaction.

This inventory deliberately excludes generic application reads/writes,
automatic read auditing, SSO, break-glass administration, platform-directory
reads, public verified-domain mailbox proof/admission,
background domain reverification, and all other action-token/email delivery
telemetry beyond the administrator setup/reset facts listed above. Those
exclusions must not be represented to operators as covered activity.
Except for the explicitly listed export denial, retained-history deletion
conflict, and completed domain-proof mismatch, rejected validation and
authorization attempts are operational request telemetry rather than a
complete durable attempt log.

Administrator-created identity persistence is audited in its creation
transaction. Optional setup delivery then records each fact it actually knows;
provider failure records a separate failed delivery and an atomic compensating
identity rollback. Startup repair of legacy tenant-owner assignments records
one application-scoped system reconciliation event, with a bounded count, in
the same transaction as the repaired rows. Initialization or an explicitly
versioned semantic change to the resolved authorization registry records an
application-scoped system event containing only the bounded old/new registry
versions and fingerprints. The manifest and audit event commit in the startup
transaction; unchanged restarts add no event.

These guarantees apply to Zero's authorized route and coordinating-service
surfaces. Raw `UserStore`, `TenantStore`/`TenancyService`, and role-store calls
remain trusted server-side building blocks: they are not self-authorizing and
must not be used as an application control plane. The protected platform
tenant-lifecycle service records customer creation, suspension, and
reactivation with durable application-scope actor attribution; direct
low-level store calls do not.

## Authorized HTTP routes

All routes require a current Bearer session. They use live durable account and
parent-session authority, not only role/scope claims from an old access token.

| Route | Authority |
| --- | --- |
| `GET /auth/audit/platform/events` | single mode: legacy global `admin`; multi mode: active Administration Organization plus `application.audit:read` |
| `GET /auth/audit/platform/export` | single mode: legacy global `admin`; multi mode: active Administration Organization plus `application.audit:read` |
| `POST /auth/audit/platform/prune` | single mode: legacy global `admin`; multi mode: active Administration Organization plus `application.audit:manage` |
| `GET /auth/audit/tenant/events` | current active tenant plus `tenant.audit:read` |
| `GET /auth/audit/tenant/export` | current active tenant plus `tenant.audit:read` |

Tenant routes never accept a tenant ID. Zero reprojects the active tenant and
membership from the live durable session and applies the exact tenant
predicate in SQL. Platform reads intentionally include application and all
tenant scopes; each returned event includes `scopeKind` and `tenantId` so it
can be attributed.

List queries accept `limit` (1..100), opaque `cursor`, exact `action`, exact
`outcome`, inclusive `from`/`to` timestamps, and exact `targetType`. Export
accepts the same filters with `limit` up to 1000 and returns bounded NDJSON plus
`hasMore`/`nextCursor`; callers continue with the cursor rather than requesting
an unbounded dump. Malformed service-level filters and cursors return
`422 AUTH_AUDIT_QUERY_INVALID` rather than an internal error.

Export access is itself sensitive. A successful export is recorded before its
response is returned. An authenticated request denied by platform or tenant
authorization records a denied `audit.exported` event when the audit store is
available; anonymous requests do not create attacker-controlled audit rows.

## Browser SDK, hook, and packaged viewer

The public client exposes an explicit scope instead of accepting a tenant ID:

```ts
const page = await client.audit.list('tenant', {
  limit: 50,
  action: 'tenant.member-updated',
});

const next = page.page.nextCursor
  ? await client.audit.list('tenant', {
      limit: 50,
      cursor: page.page.nextCursor,
    })
  : null;

const exported = await client.audit.export('platform', { limit: 1000 });
// Platform-admin-only, explicit operator action:
await client.audit.prune();
```

`useAuthAudit({ scope: 'tenant' | 'platform', ...filters })` owns bounded
pagination, export, denial/error state, and reload. Tenant results are
synchronously masked whenever the identity, active tenant, applied filters, or
tenant session-transition boundary changes, before an effect can render data
from the previous tenant.

For a packaged accessible table, use:

```tsx
import { ControlPlaneAuditViewer } from '@zero/framework/components/auth';

<ControlPlaneAuditViewer scope="tenant" />
```

The viewer has explicit applied filters, cursor pagination, scope attribution,
and a bounded NDJSON download. It does not expose retention deletion; that
remains an explicit SDK/HTTP operator action.

## Retention worker

Startup performs a retention pass and then runs at `pruneInterval`. Each
SQLite transaction deletes at most `pruneBatchSize` eligible rows. One event
loop pass drains at most ten batches; if a full final batch indicates more
work, the worker yields and schedules a continuation. This bounds lock time and
CPU work while allowing a large expired backlog to drain much faster than one
batch every six hours.

`POST /auth/audit/platform/prune` deletes one configured batch and atomically
records its deletion count and continuation flag; operators repeat while
`hasMore` is true. Background retention emits
operational observability codes for deletion/failure but does not recursively
write one durable audit row for every automatic prune pass.

Retention is an application policy, not a cryptographic tamper-evidence or
external archival guarantee. Deployments that require WORM storage,
independent custody, legal holds, cross-region aggregation, or SIEM forwarding
must export/forward the bounded events into an independently controlled sink
and test that integration for their compliance regime.
