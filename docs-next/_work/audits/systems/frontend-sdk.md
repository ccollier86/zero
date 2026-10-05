---
id: zero.inventory.frontend-sdk
type: inventory
audience: [agent, maintainer]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Frontend Client SDK And Data Composition

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns the integrated browser client, authenticated transport, collection/resource facades and React data composition. Backend systems own authorization and domain behavior. Low-level Sync APIs remain public but distinct from the app-facing collection SDK.

## Features And Documentation Coverage

| Feature | Exact public surfaces/source evidence | Canonical planned guide |
| --- | --- | --- |
| Client lifecycle | createClient/getClient/Client/ClientConfig; [src/frontend/client/sdk.ts](../../../../src/frontend/client/sdk.ts) | `frontend/sdk/client-lifecycle.md` |
| Authenticated HTTP | FetchInit/FetchError; client.fetch/get/post/put/patch/delete | `frontend/sdk/http.md` |
| Eden/error unwrap | Api/ApiError/unwrap/client.api; [src/frontend/client/api.ts](../../../../src/frontend/client/api.ts) | `frontend/sdk/typed-api.md` |
| Typed realtime collections/natural identity | client.collection/Collection; [src/frontend/client/collection.ts](../../../../src/frontend/client/collection.ts) | `frontend/sdk/collections.md` |
| Exact mutation receipts | insertAsync/updateAsync/removeAsync; SyncMutationError/isSyncMutationError and receipt codes/default/max timeout constants/SyncMutationWaitOptions; [src/sync/client/sync-mutation-receipts.ts](../../../../src/sync/client/sync-mutation-receipts.ts) | `frontend/sdk/acknowledged-mutations.md` |
| HTTP resources | client.resource/ResourceClient/ResourceMutationError/list/get/create/update/delete/remove; [src/frontend/client/resource-client.ts](../../../../src/frontend/client/resource-client.ts) | `frontend/sdk/resources.md` |
| Full/lazy reactive hooks | useCollection/useLazyCollection/useRow/useQuery/useStatus; [src/frontend/client/data-hooks.ts](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| Page/record/selection | useDataPage/useRecord/useRecordByIdentity/useDataSelection/buildDataPageQuery/buildResourceListQuery; [data-page-hooks](../../../../src/frontend/client/data-page-hooks.ts), [record composition facade](../../../../src/frontend/client/data-composition-hooks.ts) | [Page/record/selection guide](../../../frontend/sdk/data-composition.md) |
| Resource hooks | useResourceClient/useResourceList/useResourceRecord/useResourceActions; [src/frontend/client/resource-hooks.ts](../../../../src/frontend/client/resource-hooks.ts) | `frontend/sdk/resource-hooks.md` |
| Mutations/connection | useMutation/useConnectionHealth; [src/frontend/client/mutation-hooks.ts](../../../../src/frontend/client/mutation-hooks.ts), [src/frontend/client/connection-health-hooks.ts](../../../../src/frontend/client/connection-health-hooks.ts) | `frontend/sdk/mutations-and-connection.md` |
| Auth/scoped administration | Client auth/account/tenant/MFA/member/invitation/domain methods; applicationAdmin/apiKeys/audit/platformAdmin inherited facades | `frontend/guardian/sdk-surfaces.md` |
| Data readiness/Studios | client.dataRealm/dataStudio/storageStudio; Studio/readiness hooks and operation/error helpers | `frontend/sdk/scoped-control-planes.md` |
| Persistent/ephemeral state | usePreference/useFormDraft/useServerState/useServerStateReady/useEphemeral/useEphemeralTopic/useEphemeralErrors | `frontend/state/index.md` |
| Rooms/notifications/Torrent | Individual service hooks in [hook catalog](../catalogs/frontend-hooks.md); owning backend contracts remain canonical | `frontend/sdk/service-composition.md` |
| Low-level Sync | /sync/client SyncProvider/useSyncClient/useTable/useRow/useQuery/useSyncStatus/StateClient/EphemeralClient/store surfaces | `frontend/sdk/low-level-sync.md` |

## Public Surface And Integration Map

The [SDK member catalog](../catalogs/frontend-sdk-members.md) enumerates **227 property/method records across 20 interfaces**, preserving root versus nested/inherited surfaces. The [hook catalog](../catalogs/frontend-hooks.md) enumerates **131 hook records** and exact routes. The [support catalog](../catalogs/frontend-support.md) separates helpers/errors from UI.

Root/react owns the integrated client. /react/hooks is the platform-hook compatibility barrel; /hooks owns generic UI hooks, not useForm. One Sync connection combines classified app/system/tenant data planes and platform tables. Guardian refresh/session authority and the authorization boundary fence HTTP work and cached presentation on identity/tenant changes. Resource idempotency and exact async receipts differ from optimistic cache changes. Cancelled waits do not imply a write was cancelled.

The JSON HTTP shortcuts stringify their supplied body; they are not a generic native `fetch` replacement for FormData. Typed Eden `client.api` delegates its request body and auth transport through `AuthClient.fetchWithAuth`, including its supported multipart path. Recipes must choose the appropriate public transport rather than imply that `client.post(path, formData)` uploads multipart data.

InternalClient auth/state/ephemeral/_syncClient/_authorizationDataBoundary are framework wiring, not required app imports. Guardian, Resources/Sync/Fabric, Data Studio, Storage Studio, Rooms, Notifications and Torrent inventories own deeper domain contracts; this SDK ledger links them rather than duplicating enforcement.

## Configuration Inventory

| Exact paths | Type/default/resolution and exposure |
| --- | --- |
| ClientConfig.url/tables/tableSyncPlanes | Required URL; optional raw/defineTable tables and server-authored plane map; client-creation/browser-visible, never authority. |
| auth/stateSync | false defaults; stateSync requires auth; SDK construction/recreation, not live server settings. |
| authorizationRevalidationIntervalMs | Optional ms; source default 30000, 0 disables hint polling; server enforcement unchanged. |
| autoConnect/maxReconnectAttempts | true/Infinity source defaults; construction/reconnect policy. |
| resourcePrefix | String, /api/resources default; normalized facade routes at construction. |
| onError/onReconnect/onMutationRejected | Optional callbacks; mutation rejection notification follows local rollback. |
| FetchInit.method/body/headers/signal/json | Request-time options; centralized auth/refresh/error behavior. |
| Resource prefix; list filters/sort/limit/offset/signal; write signal/idempotencyKey | Facade/request-time; typed results and method-specific idempotency. |
| Hook Options/Result members | Declarations linked individually in hook catalog; query/render-time, not config-directory discovery. |

All SDK/Collection/Resource option/member spellings are captured in the member catalog. Planned `frontend/sdk/configuration.md`. Doctor config/usage checks are not browser runtime qualification and no env binding or secret projection is implied.

## Evidence And Verification

Tests present: [src/frontend/client/sdk.test.ts](../../../../src/frontend/client/sdk.test.ts), [src/frontend/client/api.test.ts](../../../../src/frontend/client/api.test.ts), [src/frontend/client/api-auth-multipart-http.test.ts](../../../../src/frontend/client/api-auth-multipart-http.test.ts), [src/frontend/client/collection.test.ts](../../../../src/frontend/client/collection.test.ts), [src/frontend/client/resource-client.test.ts](../../../../src/frontend/client/resource-client.test.ts), [src/frontend/client/resource-hooks.test.ts](../../../../src/frontend/client/resource-hooks.test.ts), [src/frontend/client/data-composition-hooks.test.ts](../../../../src/frontend/client/data-composition-hooks.test.ts), [src/frontend/client/auth-authorization-browser-boundary.test.ts](../../../../src/frontend/client/auth-authorization-browser-boundary.test.ts), [src/frontend/client/workflow-hooks.test.ts](../../../../src/frontend/client/workflow-hooks.test.ts). Examples package-mode and guardian-fabric-proof. Research [docs/frontend/sdk.md](../../../../docs/frontend/sdk.md).

## Findings, Philosophy, And Known Future Plans

- createClient throws when another singleton exists; getClient is nullable. Do not promise general simultaneous browser-client isolation.
- useRow/useQuery each have two distinct public implementations/routes; providers and recipes must distinguish them.
- Static symbols do not establish SSR/disconnect/auth-transition correctness or every tenant/profile combination.
- Established principle: centralized authenticated transport and reactive projection reuse server-owned contracts. Capability discovery and expanded agent integration in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) are future work.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 against SDK construction/cleanup/request fences, Collection receipts and natural identity, ResourceClient idempotency/response methods, data/resource/mutation hooks and the frontend/Sync public barrels. The member catalog's individual HTTP, collection, receipt, resource, Guardian and scoped-control-plane records now point to their actual planned contract homes instead of routing every root member to client lifecycle. Public low-level Sync and app SDK hook names remain separate.

Executed with automatic env loading disabled, mocked transport and synthetic rows:

```sh
bun --no-env-file test src/frontend/client/sdk.test.ts src/frontend/client/api.test.ts src/frontend/client/collection.test.ts src/frontend/client/resource-client.test.ts src/components/data-table/data-table-source.test.ts src/components/data-table/data-table-state.test.tsx src/components/data-table/row-identity.test.ts src/components/master-detail/master-detail-selection.test.ts src/frontend/router/auth-policy.test.ts
```

Result on Bun 1.3.14: **57 passed, 0 failed, 186 assertions across nine files**. No application modules, provider calls, live DB/storage or local app server were executed. This shared checkout contains approved pending corrections and is therefore dirty-working-tree verification, not qualification of the clean main artifact. This closes only targeted inventory reconciliation; discovered UI write-acceptance defects are tracked with [data controls](./frontend-data-controls.md) and remain separate from these SDK contracts.

## Navigation And Completion Review

### Supplemental Accepted Page Membership Closeout

Detailed source writing confirmed that useDataPage returned the complete shared
collection instead of its own query membership, discarded numeric server order,
and could be replaced by another same-table consumer. The initial actual-hook
synthetic React run recorded1pass5fail. The correction gives each query ordered
IDs/snapshots, keeps live matching cache updates, retains a page through another
consumer's cache eviction, and removes/requeries after authoritative Sync changes,
catch-up and snapshots. Query/authorization/unmount fences remain active.

The substantial paged-query responsibility now lives in data-page-hooks.ts with
a small pure data-page-projection.ts helper; data-composition-hooks.ts preserves
the public facade and focuses on record composition. Collection.primaryKey is an
additive optional readonly metadata accessor backed by the actual declaration,
without requiring legacy app adapters to rebuild their shape. The legacy
replaceCollection default/option remains unchanged.

Manual refresh with autoLoad=false was also corrected, and query failure emission
uses safe standard code/surface/stage metadata rather than raw filter/error values.
The focused 13 hook tests cover custom numeric keys, same-table pages, accepted
order, current updates/deletes, cache replacement, snapshots, unrelated tables,
superseded responses, manual load, scope replacement and unmount. The actual run
`bun --no-env-file test src/frontend/client/data-page-hooks.test.tsx src/frontend/client/data-composition-hooks.test.ts src/frontend/client/collection.test.ts`
passed 24 tests / 52 assertions, no live app/provider/database or network used. This
uses a minimal in-memory DOM for null-rendered hooks, not a browser certification.
Independent review identified an additional manual-load lifecycle gap: with
autoLoad=false, a manually started request had no effect-owned unmount cleanup.
A deterministic regression failed before correction (12 passed / 1 failed).
Lifetime ownership now fences every request independently of automatic loading,
aborts outstanding manual requests on unmount, and makes a retained refresh
callback inert after unmount. The final focused SDK run above includes this case.

Root independently reviewed the final hook source and reran the combined
useDataPage/useAsyncAction/generic-state contracts: 23 passed / 58 assertions.
No further source correction was requested. Global typecheck and installed-package
qualification remain separate gates; these checks describe the dirty source only.

First-draft feature homes now exist for all15SDK groups, with state/service/Studio
companions linked from the SDK/frontend indexes. This is placement, not readiness.

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.
