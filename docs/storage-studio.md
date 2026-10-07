# Storage Studio

Storage Studio is Zero's opt-in, Guardian-scoped control plane for managed
organization and personal file drives. It extends the existing Storage engine:
there is still one drive/object catalog, one ACL implementation, and one
configured byte adapter. Studio adds ownership, stable keys, lifecycle,
idempotent control operations, quotas, jobs, browser/server SDKs, and an
adaptive management surface.

Storage Studio is disabled by default. Existing Storage applications keep the
legacy routes, hooks, and component behavior until
`storage.studio.enabled: true` is configured. Studio requires Guardian/auth;
it is not an anonymous drive-provisioning service.

## System boundaries

Storage Studio deliberately separates four kinds of authority:

1. **Guardian** supplies the live identity, active application/organization
   scope, membership, roles, permissions, session or user API key, and
   authority revision.
2. **Storage Studio** stores drive profiles, operation receipts, quota
   reservations, and jobs in Zero's private system database.
3. **Storage ACLs** continue to decide who may read, write, or administer
   objects in a drive.
4. **The Storage adapter** owns bytes. The built-in local adapter stores them
   in content-addressed files outside SQLite.

Fabric is independent. Studio works in single-database and Fabric applications;
it derives application or tenant scope from Guardian and never asks the browser,
function, workflow, or machine principal for a tenant ID, database reference,
provider namespace, filesystem path, or adapter selection. Enabling Fabric does
not move blob bytes into a tenant database.

Managed `createApp()` composition mounts Storage through an Elysia plugin,
creates the Studio service during managed startup, attaches its scoped facade to
`zero.storage`, and fails startup before accepting traffic if the configured
adapter does not declare the supported `shared-cas` contract.
The implementation runs in Zero's Bun process: Elysia owns request admission
and start/stop lifecycle, `bun:sqlite` backs the system-plane records through
ReactiveDB, and the configured Storage adapter owns streamed blob I/O. Studio
does not introduce a Node service, sidecar, or second HTTP authority layer.

## Enable and configure Studio

Merge the advanced-authorization fragments into the app's Guardian registry,
then enable Studio under the existing `storage` object:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import {
  STORAGE_STUDIO_PERMISSION_REGISTRY,
  STORAGE_STUDIO_ROLE_FRAGMENTS,
} from '@zero/framework/storage';

export default defineZeroConfig({
  // db, systemDb, tables...
  auth: {
    tenancy: { mode: 'multi' },
    authorization: {
      mode: 'advanced',
      permissions: {
        ...STORAGE_STUDIO_PERMISSION_REGISTRY,
      },
      roles: {
        owner: { allPermissions: true },
        'storage-manager': STORAGE_STUDIO_ROLE_FRAGMENTS.manager,
      },
    },
  },
  storage: {
    defaultPresignedTTL: 900,
    studio: {
      enabled: true,
      organizationDrives: true,
      personalDrives: false,
      personalSelfService: false,
      isolation: 'shared-cas',
      maxCapabilityTTL: 3_600,
      publicAccess: {
        allowPublicDrives: false,
        allowPublicObjects: false,
      },
      defaultGrants: [
        {
          grantType: 'role',
          grantValue: 'owner',
          permission: 'admin',
        },
      ],
      limits: {
        maxOrganizationDrives: 25,
        maxPersonalDrivesPerUser: 1,
        maxObjectsPerDrive: 100_000,
        defaultDriveSizeBytes: 100_000_000_000,
        defaultFileSizeBytes: 500_000_000,
        maxDriveSizeBytes: 200_000_000_000,
        maxFileSizeBytes: 1_000_000_000,
        maxConcurrentUploadBytes: 500_000_000,
      },
    },
  },
});
```

Unknown keys and invalid combinations fail configuration. The defaults are:

| Setting | Default | Contract |
| --- | --- | --- |
| `enabled` | `false` | Studio routes and managed-drive behavior are inert until enabled. |
| `organizationDrives` | `true` | Application-owned drives in single mode; organization-owned drives in multi mode. |
| `personalDrives` | `false` | Allows a drive owned by the active user inside the current application/organization scope. |
| `personalSelfService` | `false` | Lets an authenticated user provision their own personal drive; requires `personalDrives`. |
| `isolation` | `'shared-cas'` | The only public Storage Studio adapter contract in this release. |
| `defaultGrants` | `[]` | Engine ACLs installed atomically with each new drive. A user grant may use `'$creator'`. |
| `publicAccess` | both `false` | `allowPublicDrives` requires `allowPublicObjects`; ordinary private ACL behavior remains the default. |
| `maxCapabilityTTL` | `storage.defaultPresignedTTL` | Upper bound for managed-drive presigned URLs and upload grants. The default TTL cannot exceed it. |
| `limits.maxOrganizationDrives` | `100` | Managed application/organization drives per scope. |
| `limits.maxPersonalDrivesPerUser` | `10` | Managed personal drives per user and scope. |
| remaining byte/object limits | `0` | Zero means no configured Studio ceiling. Adapter and request bounds still apply. |

`shared-cas` means managed drives share the adapter's content-addressable blob
pool while drive IDs, object metadata, Guardian authority, and Storage ACLs
provide logical isolation. The built-in local adapter declares this contract.
An enabled Studio fails startup when an adapter does not declare `shared-cas`;
other isolation values are rejected by configuration in this release.

Zero 2 also validates the Storage adapter's mutation-safety contract at both
`createStoragePlugin()` startup and direct `new StorageService(...)`
construction. Every adapter must provide synchronous `removeBlobSync()` so a
zero-reference deletion can remain inside the same non-yielding SQLite writer
fence as its lease check. It must declare one of these write contracts:

- `writeShutdownSafety: 'cooperative'`: `writeBlob()` observes the supplied
  `AbortSignal` and settles promptly during shutdown. Zero keeps teardown
  joined if the adapter violates that promise.
- `writeShutdownSafety: 'durable-publication'`: every published blob has a
  restart-recoverable opaque receipt, and the adapter implements
  `listPendingBlobPublications()` plus `settleBlobPublication()`. Only this
  contract permits a bounded shutdown handoff.

The asynchronous `removeBlob()` method remains in the interface for source
compatibility, but the shared-CAS cleanup engine does not use it. The built-in
local adapter implements the complete contract, including streamed staging,
atomic publication, durable receipts, cancellation, and crash recovery.

## Guardian control authority and object access

Storage Studio exports permission definitions and reusable role fragments. The
application decides its final role keys and spreads the fragments into its
advanced Guardian registry.

| Permission | Control-plane authority |
| --- | --- |
| `storage:catalog:read` | View managed-drive catalog and safe lifecycle/usage information. |
| `storage:drives:provision` | Provision an application/organization drive in the active scope. |
| `storage:drives:manage` | Change managed drive metadata and quota settings, and run non-destructive control-plane lifecycle actions. |
| `storage:drives:delete` | Run destructive lifecycle operations. |
| `storage:personal-drives:provision` | Provision a personal drive when configuration also permits it. |

The exported role fragments are `viewer`, `provisioner`, `manager`,
`personalProvisioner`, and `administrator`. They are templates, not installed
role names.

In Guardian simple mode, the single-mode application administrator and the
multi-mode organization owner receive elevated Studio control authority. In
advanced mode, `allPermissions` and the explicit permissions above apply.
`personalSelfService` is an additional policy switch for the active user's own
drive.

Control authority is not object authority. File reads, writes, and downloads
still use the existing `read`, `write`, and `admin` Storage ACLs for role,
user, or trusted-property targets. Listing, granting, or revoking a drive or
object ACL requires effective Storage `admin` access at that resource;
`storage:drives:manage` alone never grants byte access or ACL administration.
Public visibility must also be enabled by `storage.studio.publicAccess` before
an administrator can select it. Provisioning grants the creator `admin` access
by default; pass `creatorAccess: 'none'` or another permission deliberately
when a different policy is required. Because `defaultGrants` defaults to an
empty list, other organization members—including members who can read the
Studio catalog—receive no object access unless ownership or an explicit
drive/object ACL grants it. Platform Administration Organization
membership never implies access to customer organization bytes or a global
cross-tenant storage inventory. A platform operator must explicitly enter or
switch to the customer organization and hold both the required Studio control
permissions and the relevant Storage ACL.

## Ownership and stable keys

Every managed drive has one private profile beside its canonical
`storage_drives` row:

- `organization` maps to application ownership in single mode and active
  organization ownership in multi mode;
- `personal` maps to the active user but remains inside the application or
  organization where it was created;
- `key` is immutable and unique within that owner scope, while the display name
  remains editable;
- lifecycle, revision, capability generation, provider namespace, safe failure
  code, actor anchors, and timestamps remain server-owned.

Use the stable key from functions and workflows rather than persisting opaque
drive IDs in app code. Keys normalize to lowercase and must match
`[a-z][a-z0-9_-]{0,99}`.

Guardian membership removal revokes that person's session, user API-key, and
live scoped-service authority immediately. A personal drive is retained; an
authorized organization administrator can then apply an explicit lifecycle
decision. Zero does not silently transfer or delete it as a side effect of
membership removal.

Presigned URLs and upload grants are deliberately detached, path/method-scoped
bearer capabilities rather than live memberships. A capability issued before
removal remains usable only until its configured expiry or a managed-drive
generation change invalidates it; `maxCapabilityTTL` is the server-side upper
bound. Membership removal does not retroactively turn an issued bearer token
back into a session check.

## Provisioning, edits, lifecycle, and jobs

Every provisioning, update, and lifecycle mutation carries an operation ID.
An exact retry returns or resumes the original operation; reusing the same ID
for different input returns `STORAGE_IDEMPOTENCY_CONFLICT`. Edits and lifecycle
changes also require the current profile revision and reject stale input with
`STORAGE_REVISION_CONFLICT`.

Operation IDs contain 1–128 letters, digits, dots, underscores, colons, or
hyphens and begin with a letter or digit. The browser SDK creates one
automatically; durable callers should persist it with their own unit of work.

The lifecycle state machine is:

```text
provisioning -> ready | degraded | failed
failed|degraded -> provisioning (retry)
ready|degraded -> suspended -> ready
ready|degraded|suspended -> deleting -> deleted -> restoring -> ready
```

Suspension and deletion invalidate the managed drive's capability generation.
Presigned URLs and upload grants issued for an older generation cannot be used
after that boundary. Object operations are admitted only for a `ready` managed
drive. In the shipped `shared-cas` contract, deletion permanently purges the
drive's objects. `restore` reactivates the managed drive identity and settings
as an empty drive; it does not recover deleted file bytes. A provider-specific
lifecycle hook may recreate external infrastructure but does not change that
public data-recovery promise.

Cleanup work is persisted in the private `_storage_jobs` table with bounded
attempts, availability time, leases, status, and safe failure codes. The public
job projection deliberately excludes provider namespaces, object paths,
operation hashes, and lease ownership. Job pages are cursor-bounded to at most
100 entries. The Storage plugin starts one managed maintenance worker after
Studio composition. It recovers expired leases, drains due cleanup work in
bounded passes, wakes when new work arrives, retries retryable provider
failures with bounded backoff, prunes expired terminal operation receipts, and
retries retained zero-reference blob cleanup. Plugin shutdown cancels future
wakes and joins the active pass before releasing Storage services. A restart
resumes from the durable job/lease state; callers do not need to run a separate
cleanup command. Completed idempotency receipts are retained for 30 days before
bounded maintenance pruning.

## Quotas and upload admission

Managed uploads enforce the configured drive byte limit, file byte limit,
object-count limit, and aggregate in-flight byte limit. Admission uses durable
reservations in the system database, includes overwrite deltas, and settles the
reservation with the metadata mutation. Failed or expired work releases its
reservation.

The local adapter stages and hashes uploads incrementally. The service checks
Guardian authority at the request boundary and again around asynchronous commit
work. Cleanup failures are retained for retry instead of being reported as a
successful object mutation.

## Browser SDK

Every Zero browser `Client` exposes `client.storageStudio`. It uses the same
authenticated transport, refresh behavior, Guardian API-key admission, and
authorization-scope cancellation as the rest of the SDK.

```ts
const capabilities = await client.storageStudio.getCapabilities();
const firstPage = await client.storageStudio.listDrives({
  owner: 'organization',
  lifecycle: 'ready',
  search: 'artifact',
  limit: 50,
});

const created = await client.storageStudio.provisionDrive({
  owner: 'organization',
  key: 'artifacts',
  name: 'Artifacts',
  creatorAccess: 'admin',
});

await client.storageStudio.updateDrive(created.value.profile.driveId, {
  expectedRevision: created.value.profile.revision,
  name: 'Build artifacts',
});
```

The surface provides:

- `setScope()` and `clear()` for custom integrations that own the Guardian
  scope lifecycle;
- `getCapabilities()`;
- `listDrives()`, `getDrive()`, and `getDriveByKey()`;
- `listDriveJobs()`;
- `provisionDrive()`, `updateDrive()`, and `changeDriveLifecycle()`.

Mutation methods generate an operation ID when one is not supplied. A
`StorageStudioMutationError` preserves the ID. If
`requiresSameIdempotencyKey` is true or `outcome === 'unknown'`, retry the exact
same input with `options.operationId = error.operationId`; do not generate a new
ID and guess whether the first write committed. This also applies when the
Guardian scope changes after a mutation was sent: reads are discarded with an
`AbortError`, while mutations reject with an unknown-outcome
`StorageStudioMutationError` carrying the original operation ID.

The packaged React hooks set the SDK's opaque scope key automatically. A custom
low-level integration must call `client.storageStudio.setScope()` with its
current `useAuthorizationScopeBoundary().key` and clear or replace it whenever
the Guardian scope changes.

## Adaptive management UI

For a fully wired Studio dashboard, render `StorageStudioManagement` inside
`AppProvider` or `ClientProvider`:

```tsx
import { StorageStudioManagement } from '@zero/framework/react';

export function StoragePanel() {
  return <StorageStudioManagement className="h-[42rem]" />;
}
```

It composes a compact master/detail workspace with catalog search and owner /
lifecycle filters, cursor pagination, provisioning, file browsing and uploads,
usage, access/settings inspector tabs, lifecycle actions, and safe job history.
Catalog search accepts at most 120 characters. The same search control performs
a bounded server-side literal search over the current folder's immediate
children while in file view; it is not limited to the page already loaded in
the browser. Drive and file pages both expose previous/next controls.
Storage Studio's drive catalog, Studio file view, and reusable
`StorageFileBrowser` now share `DataTableControls`: compact search appears
first, then view-specific filters, with actions in the responsive action group.
This changes presentation only; the existing controllers, server-backed query
semantics, component props, and inspector slots require no caller rewrite.
Exact-object grants are editable in the selected file/folder inspector, while
inherited drive and ancestor grants are shown read-only and must be changed at
their source; folder grants inherit to descendants. Actions are projected from
live server capabilities; hiding a button is never the authorization boundary.

Its operational bottom-bar actions are icon-only at rest and expand their full
label on hover or keyboard focus; accessible names stay complete. Touch reveals
on the first tap and invokes on the second, with selection changes retiring the
disclosure. Keyboard Enter/Space and mouse clicks still activate once. Reduced
motion reveals immediately. Primary New Drive/Upload/New Folder labels remain
visible, and the action strip moves to a separately scrolling row at narrow
widths. Custom RecordNavigationBar users can choose `actionLabelMode="visible"`
or per-action `labelMode: 'visible'`. Controller permissions and confirmation
remain authoritative.

Access forms wrap according to the **inspector width**, not the overall desktop
viewport, keeping grant type, target and access-level controls reachable in a
narrow pane. Current/direct/inherited grants render as compact rows inside
labeled, keyboard-focusable scroll regions bounded to 20rem. Long target IDs
truncate rather than widen the workspace, with their full value available via
the row title. Revoke buttons identify their target; inherited rows remain
read-only and must be changed at their source. This presentation change keeps
the existing public component props and ACL semantics unchanged.

Drive/object permission panels reserve one grant-or-revoke operation before
React paints pending state, then await the SDK action. Target, organization/
authorization boundary or admin-capability replacement retires the old UI
lifetime. Late outcomes cannot notify/refresh a successor or unlock its pending
operation. Failure accounting stays safe and target-bound without stale toasts;
`onChanged` notification failure does not convert an accepted mutation to a
failed/retryable one. These are presentation guards, not server rollback.

The packaged preview uses a short-lived presigned download URL. Built-in
renderers cover raster images, audio, video, sandboxed PDF, and escaped text
bounded to 512 KiB; SVG and HTML are not rendered. Supply the `filePreview`
inspector slot for a different renderer. Scope changes immediately mask the
catalog, selection, and preview, abort or discard stale work, and then load the
replacement scope. File metadata and visibility edits remain ordinary object
operations and use the selected path's live write/admin capability. Upload and
folder creation likewise use the open folder's effective capability rather
than assuming drive-level access. The UI distinguishes a direct visibility
setting from effective inherited/public access. Server policy gates
private-to-public changes; when policy is tightened, an already-public drive
or object still exposes the private remediation action.

`StorageManagement` remains the reusable adaptive presentation component. Its
existing no-prop call keeps the legacy hook-backed Storage experience for
compatibility. Supply a `StorageManagementController`, or use
`useStorageStudioManagement()` / `StorageStudioManagement`, to activate the
native Studio control plane. `inspectorSlots` add app-specific access, sharing,
preview, settings, usage, or job content without forking the shell.
Custom controllers may project `currentPathAccess` so Upload and New Folder use
the open folder's effective ACL. Omitting it retains the legacy controller
fallback.

### File paths and deletion

Pass logical paths, such as the `path` returned by `FileInfo`, directly to the
Storage hooks and SDK actions. Do not URI-encode them first. The official
transport encodes each path segment; the HTTP wildcard boundary decodes it
exactly once before canonical path validation, authorization and lookup. This
applies to downloads, file information, metadata updates and deletion.

Spaces, Unicode, `%`, `#`, `?` and `+` in filenames remain part of the logical
name. For example, `/report 1.txt` and `/report%201.txt` identify different
objects. Invalid URI escapes, encoded folder separators and traversal paths
are rejected with `STORAGE_INPUT_INVALID` (400); an authorized lookup of a
genuinely missing object still returns `STORAGE_NOT_FOUND` (404).

The packaged file browser keeps its hold-to-confirm Delete interaction. A
completed hold awaits the normal authenticated delete, then clears selection
and refreshes the folder. Early release or cancellation does not delete a
file. The path correction requires no component-prop changes or data migration.

### Public downloads: drive-wide or individual files

Storage Studio already supports both choices. Enable publication deliberately
inside the existing app configuration:

```ts
import type { AppStorageConfig } from '@zero/framework/server';

export const storage: AppStorageConfig = {
  studio: {
    enabled: true,
    publicAccess: {
      allowPublicDrives: true,
      allowPublicObjects: true,
    },
  },
};
```

Merge this storage module with the application's other normal configuration
and restart through its normal update workflow. These policy switches permit
publishing; they do not automatically make a resource public. Both default
false. Public drives require public objects to be enabled; object-only
publication may be enabled while drive publication remains disabled.

For a whole drive, select it and use **Settings → Visibility → Public read →
Save settings**. All existing and future files then permit anonymous downloads.
For an individual file in a private drive, select it and use **Sharing → Public
visibility → Make public**. **Make private** clears the object's own flag, but
does not override public access inherited from a public drive. Make the drive
private to remove that inherited public access. A public folder's flag does not
automatically publish its children; inherited ancestor ACL grants are a separate
access mechanism.

The packaged visibility controls stay visible when publishing is disabled and
explain the policy requirement. Public resources retain their private
remediation action after policy tightening. Live Storage ACL/admin and managed
control-plane checks remain enforced. Public download access never enables
anonymous upload, mutation, or permission changes; expiring presigned links are
still a separate alternative for sharing private files.

## Scoped server API

App-owned Elysia routes and actor-owned Torrent activities receive a
scope-closed Storage service. When Studio is enabled, use
`zero.storage.studio`; the caller never passes a tenant or user ID:

```ts
const artifacts = zero.storage?.studio?.drives.open('artifacts');
if (!artifacts) throw new Error('Storage Studio is not enabled.');

await artifacts.objects.upload(
  '/exports/result.json',
  new TextEncoder().encode(JSON.stringify(result)),
  { contentType: 'application/json' },
);

const usage = artifacts.usage();
```

The scoped surface exposes capabilities plus drive `list`, `get`, `open`,
`provision`, `update`, `lifecycle`, and `jobs`. A bound drive exposes `usage`,
object operations, permission operations, and upload-grant creation. Raw
adapter, provider namespace, attachment, purge, and cleanup seams are hidden
from request and workflow projections.

For an app-owned machine credential that has already been verified and bound
server-side to a live Guardian principal, use the public trusted boundary from
`@zero/framework/server`:

```ts
import {
  createAuthorityScopedServerServices,
  getServerRouteServices,
} from '@zero/framework/server';

const zero = createAuthorityScopedServerServices({
  access: binding.access,
  scope: binding.scope,
  services: getServerRouteServices(),
  assertCurrentAuthority: binding.assertCurrentAuthority,
  assertCurrentAuthoritySync: binding.assertCurrentAuthoritySync,
  userProperties: binding.userProperties,
});
```

`binding` in that example is application code produced only after verifying an
opaque/HMAC/mTLS-style machine credential and resolving its server-owned
organization plus current Guardian membership. Both authority fences are
mandatory. Strict projection is the default: the returned public type contains
only scoped Storage, notifications, rooms, workflows, PDF, database access,
Guardian compiler access, and scope-attributed observability emitters. Raw
databases, KV, registries, runtimes, auth stores/tokens, and `unsafe` are not
part of this machine boundary. Never populate `access` or `scope` from a request tenant selector,
and never substitute a fabricated browser session. `runAsSystem()` Torrent
steps have no Guardian user and therefore do not receive usable Studio
authority; system-only work must use a deliberately injected trusted service
whose application policy is explicit.

## HTTP contract

Studio routes live below `/storage/studio`. They explicitly admit Guardian
sessions and user API keys, return `Cache-Control: private, no-store`, and
derive scope from the authenticated authority.

| Method | Path | Contract |
| --- | --- | --- |
| `GET` | `/capabilities` | Live Studio control capabilities and safe policy projection. |
| `GET` | `/drives` | Cursor page; filters: `owner`, `lifecycle`, `search`, `cursor`, `limit` (max 100). |
| `POST` | `/drives` | Idempotently provision a managed drive. |
| `GET` | `/drives/by-key/:key` | Resolve an organization or personal stable key in the active scope. |
| `GET` | `/drives/:driveId` | Read one visible managed drive. |
| `PATCH` | `/drives/:driveId` | Revisioned, idempotent metadata/policy update. |
| `POST` | `/drives/:driveId/lifecycle` | `suspend`, `resume`, `delete`, `restore`, or `retry`. |
| `GET` | `/drives/:driveId/jobs` | Safe cursor-paginated job history. |

Object bytes and ordinary object operations continue to use the existing
`/storage/drives/:driveId/*`, presigned, and upload-grant routes. With Studio
enabled, legacy drive creation is closed so it cannot bypass managed
provisioning. Legacy update/delete routes cannot control a profiled drive, and
all legacy object/capability ingress applies the managed lifecycle, generation,
public-access, and quota policies.

The file browser sends `path`, `cursor`, `limit`, `type`, `search`, `sortBy`,
and `sortDir` to `GET /storage/drives/:driveId/list`. Search is a
case-insensitive literal substring over the selected folder's immediate-child
name/path, is capped at 200 printable characters, and participates in the
server count and cursor before the page is returned. Object ACL inspection uses
`GET /storage/drives/:driveId/permissions?objectPath=...`; grants send the same
`objectPath` in `POST /storage/drives/:driveId/permissions`. Only a direct grant
on that exact object can be revoked from its inspector. Replacing application
metadata uses `PATCH /storage/drives/:driveId/info/*` and still requires object
write access.

## Errors, logging, and audit

Storage failures use stable `STORAGE_*` codes and safe HTTP bodies:

```ts
{
  error: string;
  code: StorageErrorCode;
  retryable: boolean;
  outcome?: 'not-started' | 'not-committed' | 'committed' | 'unknown';
  requiresSameIdempotencyKey?: true;
}
```

Provider messages, paths, object names, tenant/user IDs, bearer capabilities,
and operation IDs are not reflected through the generic error boundary.
Operational rejection/failure events use Zero's observability sink. Provision,
policy, quota, lifecycle, recovery, and drive/object ACL grant or revoke
decisions also use Guardian's durable control-plane audit when that service is
available. That applies equally to authenticated HTTP calls and the
scope-closed server/Torrent surface; using the server facade does not skip the
audit boundary. Actor-owned Torrent continuations retain the initiating user
and membership for attribution, but are recorded with `system` provenance and
do not impersonate the original browser session or client.

Common caller-actionable codes include:

| Code | Meaning |
| --- | --- |
| `STORAGE_AUTHORITY_REQUIRED` / `STORAGE_AUTHORITY_CHANGED` | The live Guardian or Storage ACL authority is missing or changed during the operation. |
| `STORAGE_DRIVE_KEY_CONFLICT` / `STORAGE_PATH_CONFLICT` | A stable drive key or object path is already in use. |
| `STORAGE_REVISION_CONFLICT` | Reload the drive and intentionally reapply an edit against its current revision. |
| `STORAGE_IDEMPOTENCY_CONFLICT` | The operation ID was reused for different input; do not retry it with a changed body. |
| `STORAGE_OPERATION_IN_PROGRESS` | The same lifecycle work is already active; inspect the drive/job and retry only when appropriate. |
| `STORAGE_OPERATION_OUTCOME_UNKNOWN` | The client must reuse the same operation ID and exact input to resolve the write. |
| `STORAGE_QUOTA_EXCEEDED` / `STORAGE_LIMIT_EXCEEDED` | A configured count/byte policy or request bound rejected the work. |
| `STORAGE_NOT_READY` / `STORAGE_PROVIDER_UNAVAILABLE` | The drive/service/provider is temporarily unable to complete the operation; use the returned `retryable` flag. |
| `STORAGE_CAPABILITY_INVALID` / `STORAGE_CAPABILITY_EXPIRED` | A signed bearer capability is malformed, expired, or bound to an old generation. |

Studio routes emit `STORAGE_STUDIO_OPERATION_REJECTED` for safe client/policy
rejections and `STORAGE_STUDIO_OPERATION_FAILED` for server failures. Blob
cleanup and quota-reservation cleanup use their dedicated Storage codes. Sink
metadata is bounded to safe fields such as operation kind, stable error code,
retryability, outcome, attempt count, and opaque drive ID; it excludes paths,
object names/content, principals, credentials, and idempotency keys.
Managed worker startup, stop, pass failure, and receipt-prune events use the
`STORAGE_MAINTENANCE_*` observability codes.

## Upgrade and compatibility

- Migration `034` adds private profile, operation, quota-reservation, and job
  sidecars to the system database. Migration `035` adds durable per-checksum
  blob leases used to serialize shared-CAS publication and cleanup across
  runtimes. Neither migration rewrites blob bytes.
- Existing drives remain unprofiled legacy drives. Zero does not silently infer
  an owner or stable key and this release does not provide an adoption command.
- Studio disabled is the behavioral compatibility default: legacy drive
  creation, existing hooks/routes, and bare `<StorageManagement />` behavior
  remain unchanged. Custom adapters must still adopt the Zero 2 mutation-safety
  contract above; unsafe adapters fail startup instead of silently leaking or
  racing blob bytes.
- The Zero 2 request, verified-machine, and Torrent `zero.storage` facade is
  actor-bound. Remove caller-supplied user/owner arguments from calls such as
  `drives.create({ name })`, `objects.upload(driveId, path, data, fileName,
  options)`, and `objects.createFolder(driveId, path, isPublic)`. Raw trusted
  `getStorageService()` signatures are unchanged for backend composition.
- Enabling Studio requires an adapter that explicitly declares `shared-cas` in
  `supportedStudioIsolation`; it is the only accepted Studio isolation value
  in this release and is supported by the built-in local adapter.
- Enabling Studio closes the legacy new-drive route. Update callers that create
  drives to use `client.storageStudio.provisionDrive()`, the Studio UI, or
  `zero.storage.studio.drives.provision()`.
- Storage Studio does not require Fabric and does not change application-table
  schemas. Its private metadata stays in `systemDb`.
- Before updating a production app, back up the system database and blob root,
  inspect the migration plan, stop old runtimes, apply the normal Zero system
  migration process, and restart with all replicas on the same configuration.
