---
id: zero.inventory.storage
type: inventory
audience: [maintainer, agent]
owner: storage
status: in-review
visibility: internal
system: storage
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Storage Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Storage owns durable file bytes, drive/object metadata, hierarchical permissions, signed capabilities, and the optional Storage Studio drive control plane. It is not a tenant database adapter: managed metadata lives in Zero's system database and the local adapter uses shared content-addressed bytes. Frontend control planes and upload hooks have complementary homes in the frontend inventories.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A **drive** is the authorization and quota root for a hierarchy of folders and
objects. Object metadata lives in Zero's system database while a storage
**adapter** owns the bytes; the built-in local adapter uses shared
content-addressed blobs. **Storage Studio** is the opt-in owner-aware control
plane for provisioning and lifecycle—it is not a second byte adapter or a
physical per-drive filesystem boundary.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Managed and standalone composition | createApp storage settings; createStoragePlugin / getStorageService; @zero/framework/storage | storage.plugin.ts owns Elysia routes, multipart guard, startup and cleanup; service owns domain mutations | [Draft guide](../../../backend/storage/composition.md) |
| Storage adapter contract and local bytes | StorageAdapter, LocalStorageAdapter; Bun file/stream lifecycle | Adapter safety and declared isolation admission; content-addressed blobs are not public paths | [Draft guide](../../../backend/storage/adapters.md) |
| Drive catalog and lifecycle | StorageService.drive create/get/update/list/listForUser/delete/usage/setVisibility | Engine drive records, bounded listing and tenant scope; Studio admission differs from trusted engine creation | [Draft guide](../../../backend/storage/drives.md) |
| Objects and folders | StorageService.object upload/download/get/list/createFolder/move/copy/delete/updateMetadata | Path canonicalization, uniqueness, recursive tree updates, MIME and size enforcement | [Draft guide](../../../backend/storage/objects.md) |
| Byte range and disposition | object.downloadRange and authenticated HTTP range/download paths | Validated ranges; inline-safe types versus attachment; stream failures | [Draft guide](../../../backend/storage/downloads.md) |
| Content-addressing, deduplication and publication | Blob leases, publication journal, refcounts, deferred cleanup | Byte publication and metadata commit coordination; retry/cleanup must not remove a live blob | [Draft guide](../../../backend/storage/blob-lifecycle.md) |
| ACL grants and audit | StorageService.permission grant/list/get/revoke/checkAccess; user/role/property grants | read/write/admin; hierarchical drive/object grants; trusted property registry and authority attribution | [Draft guide](../../../backend/storage/permissions.md) |
| Visibility and public access | Drive/object visibility and Studio public-access ceilings | Public read does not grant modification or bypass managed lifecycle/tenant policy | [Draft guide](../../../backend/storage/public-access.md) |
| Presigned downloads | HMAC capability tokens and HTTP consumption | Expiry, drive/object/live permission and managed-generation checks | [Draft guide](../../../backend/storage/capabilities.md) |
| Upload grants | StorageService.uploadGrant.create and signed upload capabilities | Size/type/path limits, bounded TTL, ingress/lifecycle and live authority fences | [Draft guide](../../../backend/storage/upload-grants.md) |
| Guardian-scoped request services | Authenticated SDK and request-scoped storage facade | Current membership/roles/property provenance, credential ceilings, async and commit authority checks | [Draft guide](../../../backend/storage/request-authority.md) |
| Studio installation and capabilities | storage.studio.enabled; StorageStudioService capabilities and owner choices | Opt-in application/org/personal mode; server computes allowed control surface | [Draft guide](../../../backend/storage/studio-installation.md) |
| Studio permission fragments | STORAGE_STUDIO_PERMISSION_REGISTRY / ROLE_FRAGMENTS | Catalog read, drive provision/manage/delete, personal provision; no automatic role installation | [Draft guide](../../../backend/storage/studio-permissions.md) |
| Studio owner-bound provisioning | Service provision and /storage/studio/drives | Operation IDs, durable receipts, owner binding, immutable machine keys, creator/default ACL setup | [Draft guide](../../../backend/storage/studio-provisioning.md) |
| Studio revisions and editing | Service update with expectedRevision/operationId | Optimistic conflict detection, immutable identity, quotas, MIME/public policy | [Draft guide](../../../backend/storage/studio-editing.md) |
| Studio quotas and upload reservation | Drive counts, object/byte limits, concurrent reservation accounting | Aggregate write admission and authoritative commit checks; zero byte/count ceiling values | [Draft guide](../../../backend/storage/studio-quotas.md) |
| Studio suspend, restore and delete | Lifecycle states, maintenance jobs, provider continuations | Generations, durable leases, retries, recovery and terminal failure are explicit | [Draft guide](../../../backend/storage/studio-lifecycle.md) |
| Studio external lifecycle provider | StoragePluginConfig studioLifecycleProvider and timeout | Advanced idempotent provider hooks; not a generic cloud storage adapter | [Draft guide](../../../backend/storage/studio-providers.md) |
| Studio administration and personal data boundary | Organization/application/personal owner scopes and Guardian roles | Administration organizations can use own storage; platform capabilities do not silently mean cross-org object access | [Draft guide](../../../backend/storage/studio-authority.md) |
| Client transport, reactive metadata and upload UX | STORAGE_TABLES, SDK storage, storage hooks, StorageManagement/FileBrowser | Lazy metadata, centralized auth restoration/refresh, upload progress/cancellation, adaptive design-token controls | [Draft guide](../../../backend/storage/client-integration.md) |
| Domain errors and observability | StorageError, StorageDomainError, safe HTTP projection; OBS_CODES.STORAGE_* | Error code/outcome/receipt distinctions; sanitized audit/telemetry and app runtime cleanup | [Draft guide](../../../backend/storage/errors.md) |

## Public Surface Map

- `@zero/framework/storage` exports the plugin/service, local adapter,
  adapter/drive/object/permission/upload contracts, signed download/upload
  helpers, MIME detection, table definitions, and Storage Studio config,
  permissions, ownership, service/schema/error/HTTP contracts.
- `@zero/framework/server` selectively re-exports managed Storage composition
  and server-request projection types. Authenticated handlers receive a scoped
  facade with live authority fences; trusted setup code can access the engine.
- The client-safe root and `@zero/framework/components/storage` expose the SDK,
  storage hooks, `StorageManagement`, `StorageFileBrowser`, and Studio adapters.
  These presentation surfaces do not replace server ACL/quota enforcement.
- HTTP routes are mounted by `createStoragePlugin`; storage adapter paths,
  signing secrets, blob keys, and unscoped engine operations remain trusted
  server concerns.

## Configuration Inventory

| Path / input | Type and default | Origin, timing and interactions |
| --- | --- | --- |
| `storageDir` | string; `.storage` | Managed app resolution; local byte root must not overlap database/build/control-plane roots. |
| `storage.signingSecret` | optional nonempty string | Explicit config, then `ZERO_STORAGE_SIGNING_SECRET`, then persisted random system-database secret at storage startup; server-only. |
| `storage.defaultPresignedTTL` | positive integer seconds; 3600 | Resolution; must not exceed Studio maximum capability TTL. |
| `storage.studio.enabled` | boolean; false | Startup opt-in; omission does not install Studio management capability. |
| `storage.studio.organizationDrives` | boolean; true | Organization drives in multi mode, application drives in single mode; enabled Studio needs at least one owner mode. |
| `storage.studio.personalDrives` | boolean; false | User-owned drives inside the current app/tenant; not an independent tenant boundary. |
| `storage.studio.personalSelfService` | boolean; false | Requires personalDrives; provision still requires current authority and configured eligibility. |
| `storage.studio.isolation` | `shared-cas` only; shared-cas | Declared namespace policy and adapter admission; no drive-per-folder physical isolation promise. |
| `storage.studio.defaultGrants` | readonly grant objects; [] | grantType role/user/property, optional property grantKey, grantValue, permission read/write/admin; installed on provision. |
| `storage.studio.maxCapabilityTTL` | positive seconds; defaultPresignedTTL | Capability issuance upper bound, not a replacement for expiry/revocation checks. |
| `storage.studio.limits.maxOrganizationDrives` | integer; 100 | Per organization/application provision ceiling. |
| `storage.studio.limits.maxPersonalDrivesPerUser` | integer; 10 | Per user within active owner scope. |
| `storage.studio.limits.maxObjectsPerDrive` | integer; 0 | Zero means no configured object-count ceiling. |
| `storage.studio.limits.defaultDriveSizeBytes` / `defaultFileSizeBytes` | integer bytes; 0 each | New-drive defaults; zero unlimited, bounded by configured maximums. |
| `storage.studio.limits.maxDriveSizeBytes` / `maxFileSizeBytes` | integer bytes; 0 each | Maximum configurable drive/file quota; zero no upper bound. |
| `storage.studio.limits.maxConcurrentUploadBytes` | integer bytes; 0 | Aggregate in-flight per-drive reservations; zero unlimited. |
| `storage.studio.publicAccess.allowPublicDrives` / `allowPublicObjects` | boolean; false each | Studio public-read issuance policy, server-owned and independent from API authentication. |
| Standalone `StoragePluginConfig` | db required; adapter optional; localDir default .storage | Runtime, token/kernel/credential/property/audit resolvers, normalized studio, lifecycle provider/timeout, onServiceCreated are explicit injection inputs. |
| Standalone `StorageServiceOptions` | uploadGrantSecret, defaultPresignedTTL, tenancyMode, trusted-property and admission/lifecycle/audit hooks | Trusted service construction; not client-supplied configuration. Multi mode rejects unscoped drive creation/listing. |

Unknown app/Studio keys and malformed nested policy are rejected. No generic
env-backed Studio policy or hot config reload is implemented. The public
configuration guide must document every standalone injected dependency separately
from normal createApp use.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

Managed createApp mounts Storage against system ReactiveDB after Guardian dependencies exist. Auth middleware declares typed context and multipart ingress checks; routes stream bytes or invoke service operations. Scoped request services capture Guardian authority and recheck after awaited work and before mutation commit. Storage Studio adds owner/catalog policy, durable operation records and maintenance jobs without moving file metadata to tenant databases. Its public owner/capability projections must not disclose private adapter paths or signing material. Frontend SDK/hook/control-plane coverage must link back to permission, quota and lifecycle contracts. Cleanup drains relevant work before databases/runtime are disposed; standalone injection ownership is explicit.

## Evidence And Verification

Implementation and package/client export surfaces were inspected. The storage
directory contains 29 test files, including Studio, role projection, signing,
blob lifecycle, and adapter coverage; none was run in this inventory review.

- [src/storage/index.ts](../../../../src/storage/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/types.ts](../../../../src/storage/types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-service.ts](../../../../src/storage/storage-service.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage.plugin.ts](../../../../src/storage/storage.plugin.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-config.ts](../../../../src/storage/storage-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-config-policy.ts](../../../../src/storage/storage-config-policy.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-studio-service.ts](../../../../src/storage/storage-studio-service.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-studio.router.ts](../../../../src/storage/storage-studio.router.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-studio-access.ts](../../../../src/storage/storage-studio-access.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-domain-error.ts](../../../../src/storage/storage-domain-error.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-blob-lifecycle.ts](../../../../src/storage/storage-blob-lifecycle.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/local-adapter.ts](../../../../src/storage/local-adapter.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-request-authority-fence.ts](../../../../src/storage/storage-request-authority-fence.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-studio-router.integration.test.ts](../../../../src/storage/storage-studio-router.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-advanced-rbac.integration.test.ts](../../../../src/storage/storage-advanced-rbac.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-multi-tenant-role-projection.integration.test.ts](../../../../src/storage/storage-multi-tenant-role-projection.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-signing-secret.integration.test.ts](../../../../src/storage/storage-signing-secret.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/storage/storage-studio-idempotency.test.ts](../../../../src/storage/storage-studio-idempotency.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/storage-studio.md](../../../../docs/storage-studio.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Existing source comments still call some implemented Studio policy a future provisioning service; do not inherit comment maturity claims. The public Studio isolation type supports shared-cas only: treating logical drive authorization as physical drive isolation would be an incorrect security promise. Configuration resolution, adapter/provider deployment qualification, failure/restart examples and packaged frontend/HTTP integration need independent checks before verified status. No runtime defect has been established by this inventory alone.

## Authorized Frontend Review Supplement

The original clean inventory above is distinct from later approved working
source corrections. The [30-page frontend Storage family](../../../frontend/storage/index.md)
now owns 18 public components, 15 hooks, controller/slot contracts, Studio SDK
helpers, configuration and sourced roadmap. Named schema helpers map to its
drive-list reference; native mutation/surface helpers map to SDK integration.

Detailed review corrected unobserved dropped-upload failure; target-specific
display/action ownership during drive/path replacement and component unmount;
and malformed byte-limit drafts silently becoming unlimited. A rejected parent
settings save is now observed by its form event without fictional success.
Focused upload/selection synthetic checks passed 15 tests / 40 assertions;
settings pure/isolated component checks passed 3 tests / 26 assertions.
Both final batches were independently reviewed and rerun. No live bytes,
app/provider configuration, database or deployed app was opened.

Actual Guardian/Storage UI plus small-service Markdown TS/TSX examples (50 snippets)
compile in memory against the public source facades. This does not execute
examples or qualify an installed archive. See [example checker](../../checks/storage-service-examples.test.ts)
and [findings](../findings.md) for commands/evidence.

## Known Future Plans

User-requested future investigation: organization-managed vector stores, optional stronger physical storage isolation, additional byte adapters, shared platform logging/error views. These are not current Storage APIs or an approved implementation scope.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/storage/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [ ] Whole-platform reconciliation complete.
- [ ] Important examples and artifact/package support qualified.
- [x] First-draft guides exist and are linked; accuracy/package gates remain open.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
