# Storage Studio And Vector Studio Control-Plane Roadmap

This document plans two separate future organization data control planes:

- **Storage Studio** for organization-owned drive provisioning and operations;
- **Vector Studio** for organization-owned vector-index provisioning and
  operations.

Neither Studio is implemented by the current Data Studio work. Zero already
has a complete Storage service and an opt-in server-side Vector service; the
planned Studios would add tenant-aware provisioning, lifecycle, policy, jobs,
and adaptive management UI around those engines. This is a design roadmap, not
an API contract or evidence that any proposed route, permission, record, or
component exists. Current behavior remains documented in
[Storage](./sdk-reference.md#storage) and [Vector Store](./vector.md).

[Data Studio](./data-studio.md)—the current logical-table Studio—is the
reference for Guardian/Fabric authority, bounded command APIs, agent-friendly
installation, and polished control-plane composition. It is not a generic
backend for files or vectors, and the later Studios must not be folded into its
logical-schema or row model.

## Product Boundary

The three Studios should feel like one Zero product family without pretending
that tables, blobs, and vector indexes have the same lifecycle.

| Surface | Current foundation | Future Studio responsibility |
| --- | --- | --- |
| Data Studio | Fixed Fabric realm with logical schemas and rows | Implemented table/schema/row control plane |
| Storage Studio | Storage drives, objects, policies, grants, signed operations, hooks, and management UI | Organization provisioning, quotas, lifecycle jobs, recovery, and an adaptive operator/tenant control plane |
| Vector Studio | Configured local zvec indexes, scoped operations, filters, and AI bridge | Organization index catalog, provisioning, access policy, quotas, asynchronous ingestion/reindex work, and an adaptive control plane |

The Studios may share presentation and control-plane infrastructure. Their
services, durable records, permission fragments, error codes, migrations,
quotas, deletion procedures, and recovery logic remain domain-specific.

## Shared Control-Plane Contract

The following requirements should guide both future designs.

### Guardian authority

- An organization owns its drives or indexes. A signed-in user acts through a
  current Guardian membership and live role/permission snapshot.
- The server derives organization scope. A client cannot choose a tenant ID,
  Fabric database reference, filesystem path, adapter namespace, or vector
  collection path as authority.
- Platform-administration access is not implicit customer data-plane access.
  Cross-organization inventory, support, export, or recovery requires an
  explicit application permission and a separately audited operation.
- Packaged UI capability props only remove actions from the presentation. The
  service/router must authorize every read and mutation again.
- Session and user API-key credentials may be admitted where the owning app
  enables them, but both must resolve through the same live Guardian authority.
- Creator/updater attribution should use Guardian's ID-only identity anchors.
  Do not copy profiles, email addresses, credentials, or mutable roles into
  tenant data.

Each Studio should ship mergeable advanced-authorization permission and role
fragments. Exact names are intentionally not frozen here. At minimum, the
final permission model must distinguish catalog/read use, data-plane write
use, provisioning/policy administration, and destructive lifecycle work where
the domain needs that separation. Simple-permission installations still need a
documented, predictable mapping.

### Fabric and persistence

- Tenant selection occurs before reaching a Studio service. Service methods
  receive a scope-closed capability and have no arbitrary tenant selector.
- Tenant creation and switching remain outside `DataRealmReadyGate`. A Studio
  control plane that needs the organization data realm mounts inside the ready
  area and reports a stable not-ready state instead of falling back to the
  pinned application database.
- Durable control records, job state, idempotency receipts, and identity
  attribution belong in an explicitly selected ReactiveDB plane. Adapter-owned
  blob bytes and vector collection files do not become SQLite payloads merely
  to fit Fabric.
- Physical-tenant databases normally use database selection as organization
  scope rather than repeating a caller-controlled `tenant_id` on every row.
  Any shared catalog that spans organizations must retain an explicit trusted
  organization key and row policy.
- Existing Storage metadata and existing config-defined vector indexes require
  a compatibility and migration decision before implementation. Do not create
  a second source of truth beside them.

### Lifecycle and background work

A common lifecycle vocabulary will make the control planes easier to operate.
Candidate states are `provisioning`, `ready`, `degraded`, `suspended`,
`deleting`, `failed`, and `deleted`, with an optional `restoring` state where
recovery is asynchronous. These values are a design starting point, not current
exported constants.

Every lifecycle command should:

1. authorize against the live Guardian scope;
2. validate quotas and policy before reserving work;
3. accept a caller operation ID and make exact retries idempotent;
4. persist intent before doing irreversible adapter work;
5. execute or enqueue bounded work;
6. publish revisioned status and a safe result;
7. emit a standard operational event and, where security-relevant, a separate
   Guardian/control-plane audit record.

Long work should use a durable job record and Torrent where orchestration adds
value. A Studio still owns domain invariants and adapter calls; a workflow must
not become an authority bypass or the only record that a resource exists.
Cancellation semantics, retry classes, lease/heartbeat behavior, and restart
recovery need explicit tests.

### API, realtime, and SDK shape

- Full payload reads and all mutations use dedicated, bounded APIs. Generic
  Resource/Sync projections should carry only lightweight catalog, status,
  count, revision, and job-invalidation metadata.
- Storage object bytes, signed URLs, raw vector values, embedded source text,
  secrets, adapter configuration, and provider responses never ride through
  generic Sync snapshots.
- Pages must be count- and byte-bounded, with deterministic ordering and opaque
  or validated cursors. Search/filter input compiles from a closed model.
- Mutations use optimistic revisions where records are editable and operation
  IDs where retries could repeat external work.
- Each Studio should provide a typed browser SDK, focused hooks, a complete
  management organism, smaller composable panels, and a scoped server/headless
  service for functions and Torrent activities.
- Functions and workflows receive an already-scoped Studio service. They do
  not receive a filesystem root, raw storage adapter, vector registry, Fabric
  manager, or tenant-supplied database reference.

### Adaptive user experience

Both Studios should use the same product grammar as Data Studio and Guardian:

- a compact responsive toolbar, search/filter controls, and list/detail layout;
- capability-shaped actions for organization members and separately authorized
  platform operators;
- useful empty, provisioning, ready, degraded, permission-denied, quota,
  retryable-error, and terminal-error states;
- keyboard navigation, focus restoration, accessible labels/live status, and
  Zero design tokens throughout;
- compact inline editing for safe metadata fields without turning a row into a
  collection of bulky form inputs;
- deliberate dialogs or inspector panels for policy, quota, destructive, or
  structurally complex changes;
- live status/job/count updates without streaming sensitive payloads;
- component-level loading and mutation feedback that does not resize the
  surrounding geometry.

Shared shell primitives should be extracted only after both domain designs
prove the same need. A generic `StudioResourceService` or universal lifecycle
table would erase important differences and should not be invented up front.

### Errors, observability, and audit

- Use stable Zero error codes, safe public messages, `retryable` metadata, and
  the standard Elysia error boundary. Do not throw adapter messages through to
  the browser.
- Emit standard structured lifecycle/job events through Zero observability.
  Include safe resource IDs, state, duration, counts, and correlation IDs—not
  paths, signed tokens, object contents, vectors, source text, credentials, or
  provider secrets.
- Keep operational telemetry distinct from the append-only security/control-
  plane audit. Provisioning, permission, quota, suspension, deletion, restore,
  and platform-operator actions require an auditable actor and organization.
- Doctor should validate complete installation, Guardian fragments, Fabric
  realm/plane choices, provider configuration, unsafe shared roots, and
  incompatible limits before the app accepts traffic.

## Storage Studio

Storage Studio should extend Zero's existing drive/object system. It should not
replace the Storage service, duplicate its metadata, or make Data Studio hold
file records.

### Resource and persistence model

The design pass must reconcile the current `storage_drives`, object metadata,
permissions, signed operations, and tenant-aware fields with Fabric physical
tenant databases. The chosen model should preserve existing applications and
keep exactly one authoritative drive/object catalog.

An organization-owned drive needs, at minimum:

- an opaque logical drive ID and display metadata;
- organization ownership derived from the active Guardian scope;
- server-selected adapter/provider and opaque namespace reference;
- lifecycle state, revision, provision/restore/delete job reference, and safe
  failure code;
- usage counters and quota policy/version;
- creator/updater identity-anchor IDs and timestamps;
- drive policy plus existing user/role/property grants.

Blob bytes remain in the configured Storage adapter. Folder/prefix isolation is
the sensible default for many deployments; a dedicated root, bucket, volume,
or provider account can be an explicit application policy when stronger
physical isolation is required. The browser never supplies the resulting
physical location.

### Provisioning lifecycle

The provisioning operation should be a recoverable saga:

1. validate the organization, permission, drive-name rules, provider policy,
   and drive-count/byte quota;
2. reserve an opaque drive ID and persist `provisioning` intent;
3. allocate or verify the server-derived adapter namespace;
4. install default policy and quota records;
5. probe the adapter using a bounded, non-public health operation;
6. publish `ready` with a revision, or record a safe failed state and run
   idempotent compensation.

Retries after an unknown outcome must reuse the operation ID. A crash between
adapter allocation and catalog publication must be discoverable as an orphan
and repairable without guessing from a user-provided path.

### RBAC and policy

Studio-level authorization and existing drive capabilities solve different
problems:

- catalog/read permission allows seeing organization drive metadata;
- provision permission allows creating a drive within organization policy;
- manage permission covers display settings, quota assignment, and grants;
- object read/write/admin continues to use the existing drive/object
  capability and permission model;
- destructive permission, if separated, covers archive and permanent delete;
- explicit platform operations may inspect status or run recovery without
  automatically receiving object read access.

Permission fragments should compose with app roles such as organization owner,
storage administrator, contributor, and viewer without forcing those exact
role names on the app.

### Quotas and accounting

Storage quotas should support policy at application, organization, and drive
scope with documented precedence. Useful limits include drive count, logical
bytes, object count, single-upload size, concurrent/in-flight bytes, public
grant count, and request rate.

Uploads need reservations so concurrent requests cannot all pass a stale
usage check. Successful completion converts a reservation to committed usage;
failure/expiry releases it. A periodic reconciliation job compares metadata to
adapter reality and reports drift. Soft thresholds drive UI/notifications;
hard limits reject before accepting bytes with a stable quota error.

### Jobs and operations

Potential durable jobs include recursive delete, folder move/copy, usage
reconciliation, provider migration, retention/lifecycle enforcement, export,
restore, and orphan cleanup. Malware scanning or content processing may later
subscribe to upload events, but neither is implied by Storage Studio itself.

Each job needs bounded progress, safe counters, cancellation rules, retry
classification, and ownership. UI should expose job history and actionability
without leaking object names or paths through broad platform telemetry.

### Deletion and recovery

Drive removal should be staged rather than an immediate recursive filesystem
operation:

1. suspend new writes and revoke or expire outstanding signed capabilities;
2. drain or abort uploads and dependent jobs;
3. apply retention, legal-hold, grace-period, export, and snapshot policy;
4. perform adapter deletion asynchronously from a server-derived namespace;
5. reconcile remaining metadata/objects;
6. retain a bounded tombstone and audit evidence.

Recovery design must cover provider outages, partial uploads, catalog/blob
drift, orphan namespaces, failed recursive work, signing-key rotation,
backup/restore, and restart during every lifecycle edge. Restore must create a
new auditable lifecycle transition; it must not silently make a deleted drive
visible.

### Packaged surface

The eventual control plane should evolve `StorageManagement` rather than ship
a disconnected competing browser. Its adaptive views should cover:

- organization drive catalog and create/provision action;
- drive readiness/health, usage, quotas, and current jobs;
- file browser and upload/download flows already provided by Storage;
- settings, visibility, retention, and member/role grants;
- archive/delete/export/recovery actions gated by capability;
- a restricted platform-operator view that cannot browse object contents
  unless separately authorized.

The headless surface should accept an already-scoped Storage Studio service so
Pantheon-like functions and workflows can use an organization drive without
constructing adapter paths or passing an organization ID through app input.

### Storage Studio acceptance gates

- Existing non-Studio Storage apps keep their current behavior.
- Two organizations cannot list, address, sign, quota, or delete each other's
  drives or objects through IDs, paths, Sync, API keys, jobs, or recovery APIs.
- Concurrent quota reservations cannot over-admit the same hard limit.
- Provision, delete, and restore survive forced crashes at every persisted
  transition and reconcile orphan adapter state.
- Platform administration remains useful for health/recovery without becoming
  implicit customer file access.
- SDK, hooks, components, Doctor, errors, audit, observability, upgrade, and
  removal behavior are tested and documented together.

## Vector Studio

Vector Studio should extend the current config-defined `VectorService` and
zvec adapter. It must preserve the separation in which Vector owns persistence
and similarity search while AI owns embedding-provider/model execution.

### Resource and isolation model

An organization-owned logical index needs, at minimum:

- an opaque index ID, stable app-facing key, and display metadata;
- organization ownership derived from Guardian/Fabric scope;
- immutable or generation-bound dimensions, metric, index type, vector/text
  fields, and metadata schema;
- server-derived physical collection reference and active generation;
- lifecycle/health state, revision, counts/size, and job references;
- creator/updater identity-anchor IDs and timestamps;
- optional embedding-policy metadata that references application-approved AI
  configuration without containing provider secrets.

The preferred isolation candidate is one physical collection/generation per
organization logical index under a server-managed root. A shared collection
with mandatory scope filters should be supported only if benchmarks and
security tests prove a concrete need and every fetch/search/delete path makes
the scope non-bypassable. Clients never provide a collection path or raw
registry name.

Index structure is not ordinary editable metadata. Dimensions, distance
metric, index type, metadata schema, and embedding-model compatibility often
require a new generation plus reindex. The design should make immutable fields
obvious and use an atomic active-generation pointer when a rebuild completes.

### Provisioning lifecycle

The provisioning path should:

1. validate organization permission, an application-approved index template,
   dimensions/schema, and index-count/capacity quota;
2. reserve the logical index and generation with an operation ID;
3. derive a safe physical location below the configured root;
4. create/open the zvec collection and verify its schema/health;
5. persist the active generation and publish `ready`;
6. record a repairable failed state and clean up or quarantine partial files.

Existing config-defined indexes need an explicit compatibility story. They may
remain application-owned and outside Studio, or be imported through a one-time
validated adoption flow; startup must never silently reinterpret a current
index as organization-owned.

### RBAC and function/workflow access

The final Guardian fragments should distinguish:

- seeing index catalog/status;
- querying/fetching records;
- upserting and deleting records;
- managing schema/generations/access policy;
- provisioning, suspending, and deleting indexes;
- invoking embedding work when it consumes separately metered AI capacity.

Functions and Torrent activities require an explicit app permission in
addition to organization membership. A scoped service can resolve an allowed
logical index key inside the active organization, but it cannot accept a
caller-selected filesystem path or use an unscoped global `VectorService` as a
shortcut.

### Quotas and admission

Vector-specific limits include index count, dimensions, record count, logical
and physical bytes, batch size, concurrent ingestion jobs, query/upsert rate,
`topK`, filter complexity, and result bytes. Embedding token/cost limits belong
to the AI accounting policy even when Vector Studio initiates the work.

Bulk ingestion should reserve capacity, enforce bounded batches, and update
counts only after durable adapter acknowledgement. Periodic reconciliation
must detect catalog/collection count drift. Query admission should reject
pathological filters or result budgets before asking the adapter to allocate
unbounded work.

### Jobs and generation changes

Durable jobs may cover bulk import, embedding, metadata backfill, reindex,
generation migration, compaction, snapshot/export/import, and deletion. Each
job must pin its source/target generation, policy version, actor authority, and
input provenance so a retry cannot write into a newly activated generation by
accident.

Reindex should build a separate generation, validate counts and health, then
atomically switch the logical index pointer. Reads stay on the prior generation
until activation. Cleanup of the retired generation is a separate retryable
job after rollback/retention policy allows it.

### Deletion and recovery

Deletion should first disable new query/write admission, drain or cancel jobs,
apply snapshot/retention policy, close adapter handles, and then remove only the
server-derived generation directories. Keep a bounded tombstone and audit
record. Recursive deletion must prove the resolved path is a child of the
configured vector root; no request parameter can become the target.

Recovery needs explicit coverage for zvec WAL reopen, corrupted or missing
collections, partial provisioning, orphan generations, an interrupted active-
generation swap, count drift, provider/model changes during embedding jobs,
and restore from a versioned snapshot. A degraded index should fail safely or
serve a documented last-known-good generation rather than silently recreating
an empty index at the same key.

### Packaged surface

The eventual Vector Studio should include:

- organization index catalog, template-based create flow, and health state;
- index dimensions, metric, metadata schema, generation, counts, and size;
- access policy and function/workflow grants;
- ingestion/reindex/export/delete job progress and history;
- quotas and AI-embedding cost attribution where configured;
- a bounded, permission-gated test-query view with redacted diagnostics;
- a platform health/recovery mode that does not expose vectors, source text, or
  query contents.

Realtime projections should contain status, counts, revisions, and job
progress only. Raw vectors, embedding inputs, stored text, metadata payloads,
and query results stay on dedicated bounded APIs and should not be recorded in
logs or security audit payloads.

### Vector Studio acceptance gates

- Existing config-defined indexes and server-only Vector calls retain a clear,
  tested compatibility path.
- Organization isolation is enforced for list, fetch, search, upsert, delete,
  jobs, snapshots, and recovery—not only for ordinary query.
- Schema/dimension changes cannot corrupt or reinterpret an active collection;
  generation activation and rollback are atomic.
- Quotas, batch/result bounds, restart recovery, orphan cleanup, and deletion
  path safety have adversarial tests.
- AI keys and provider secrets never enter organization catalogs, browser
  payloads, Sync, observability, or audit records.
- SDK, hooks, components, Doctor, errors, audit, observability, upgrade, and
  removal behavior are tested and documented together.

## Delivery Sequence

The Studios should ship independently. Finishing one is not a release gate for
the other.

1. Validate Data Studio in a production-shaped organization app and record any
   shared control-plane lessons without changing its table contract casually.
2. Inventory current Storage and Vector persistence, routes, adapters,
   components, compatibility requirements, and failure modes.
3. Decide each Studio's authoritative catalog plane, lifecycle records,
   permission vocabulary, quotas, and migration/removal contract.
4. Implement only proven shared UI/job primitives; keep services and storage
   domain-specific.
5. Build and release Storage Studio through its own backend, browser,
   concurrency/recovery, security, package, and documentation gates.
6. Build and release Vector Studio separately, including generation/reindex and
   vector-specific capacity tests.
7. Exercise each with an organization-owned example in which functions and
   Torrent workflows use scoped services, then verify platform-operator and
   tenant-member experiences independently.

Until those gates are complete, applications should use today's Storage and
Vector APIs directly. Documentation and agents must describe Storage Studio and
Vector Studio as future work, never as installed Data Studio capabilities.
