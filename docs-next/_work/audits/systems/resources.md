---
id: zero.inventory.resources
type: inventory
audience: [maintainer, agent]
owner: resources
status: in-review
visibility: internal
system: resources
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

# Declarative Resources And Data Policy Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Owns declared application resources, operation policy, transport exposure, logical/global tenant realms, client field allowlists, generated CRUD and query plans. Schema alone describes rows; Resource policy and live Guardian authority enforce who can access them.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A **Resource** is a declared table plus action policy, transport exposure,
storage realm, and optional client field allowlists. **Exposure** controls
whether HTTP and/or Sync can reach it; **loading mode** controls snapshot/cache
behavior; neither grants authority. A **realm** identifies global versus tenant
data and shared-row versus physically isolated enforcement.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Definitions/actions | defineResource, ResourceDefinition, RESOURCE_ACTIONS | list/get/create/update/delete with per-action or common policy | [Draft guide](../../../backend/resources/definitions.md) |
| Transport exposure | internal/http/sync/all, RESOURCE_EXPOSURES | Independent from full/lazy loading; multi mode explicit classification required | [Draft guide](../../../backend/resources/exposure.md) |
| Data realms | globalRealm, tenantRealm(field?), realm global/tenant | Mandatory shared-row discriminator or physical tenant-bound database | [Draft guide](../../../backend/resources/realms.md) |
| Policy primitives | adminOnly/authenticatedOnly/readOnly/publicReadUserWrite/ownerPolicy/metadataPolicy/customPolicy | Policy invariants and stamp/row filters; no UI-only enforcement | [Draft guide](../../../backend/resources/policies.md) |
| Guardian policy | authorizationPolicy, guardianActorPolicy, tenantKindPolicy | Same kernel/live role authority, canonical actor fields/current tenant kind | [Draft guide](../../../backend/resources/guardian-integration.md) |
| Composition | allOf, anyOf, evaluateResourcePolicy and validators | Constraints safely compose; denial is not ignored by generated CRUD | [Draft guide](../../../backend/resources/policy-composition.md) |
| Field boundary | defineResourceFields; read/create/update/filter/sort lists | Policy sees full server rows, projection after auth, reject raw write fields before stamps | [Draft guide](../../../backend/resources/field-access.md) |
| Registry/discovery | ResourceRegistry/create/configure/load/collect/validate | Validated table references, declared auth keys, storage realm and PK consistency | [Draft guide](../../../backend/resources/registry.md) |
| Generated CRUD | createResourceCrudPlugin, ResourceCrudService; `/api/resources` | HTTP auth/validation, PK-safe persistence, transactional idempotency receipts | [Draft guide](../../../backend/resources/crud.md) |
| Lazy query planning | buildResourceListQueryPlan/buildResourceListFindPlan | Parameterized filters/order/page with mandatory scope/field limits | [Draft guide](../../../backend/resources/queries.md) |
| Realtime policy | ResourceSyncPolicyService | Read/mutation decisions used by snapshot/catchup/live and HTTP data | [Draft guide](../../../backend/resources/sync-integration.md) |
| Safe mutation input | sanitizeResourceCreateInput/updateInput; error results | Schema fields, immutable PK/identity/tenant/actor protection | [Draft guide](../../../backend/resources/input-validation.md) |

## Public Surface Map

- `@zero/framework/resources` exports definition/action/exposure/realm builders
  and types; field projection/write validation; registry/discovery/schema
  inspection; and validation APIs.
- Policies include authenticated/admin/read-only/public-write, owner/metadata/
  Guardian actor/authorization/tenant-kind/custom branches, `allOf`/`anyOf`,
  evaluation, metadata readers, and validators.
- Server execution exports `createResourceCrudPlugin`, `ResourceCrudService`,
  receipt limits, `ResourceSyncPolicyService`, safe input sanitizers/errors, and
  parameterized list/find planners. The default `/api/resources` prefix covers
  list/get/create/update/delete with transactional mutation receipts.
- `/api/data` is a separate Sync-owned lazy query plugin consuming the same
  admitted registry/policy. Compatibility registry globals remain public, but
  managed apps own an app-local validated registry.

## Configuration Inventory

`defineResource`: name defaults table; table string or typed definition; primaryKey inferred and cannot conflict; actions all five by default; policy required; exposure omission legacy all only single mode; realm omission legacy single only. `tenantRealm` defaults tenant_id only shared-row; physical database mode keeps logical declaration without requiring/stamping column. fields optional; when provided read required, create/update empty by default, filter/sort default read and cannot include hidden columns.

App `resources` defaults []; serverResourcesDir defaults ./server/resources or false; resourceRoutes defaults enabled prefix `/api/resources`, defaultLimit100/maxLimit1000. Registry reads Guardian config/current topology at startup; policies evaluate per operation, not trusted browser-supplied permission metadata.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

Guardian route credential admission and policy authorization are distinct. Resource exposure/realm constraints apply outside policy so customPolicy cannot bypass tenant boundary. Field stamping occurs after client input validation; projected output cannot leak hidden filter/order columns. Generated CRUD routes and `/api/data` share scope/policy, while Sync uses the same resource registration. Fabric tenant clients are selected only from committed authorization. FK anchors readiness can block writes until valid.

## Evidence And Verification

Implementation and the complete resources subpath barrel were inspected. The
resources directory contains 14 test files, and both multi-database examples
contain Resource declarations. No route, test, or example was run in this pass.

- [src/resources/index.ts](../../../../src/resources/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-definition.ts](../../../../src/resources/resource-definition.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-policy-types.ts](../../../../src/resources/resource-policy-types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-policy-evaluator.ts](../../../../src/resources/resource-policy-evaluator.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-field-access.ts](../../../../src/resources/resource-field-access.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-crud.plugin.ts](../../../../src/resources/resource-crud.plugin.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-crud-service.ts](../../../../src/resources/resource-crud-service.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-tenant-database-crud.integration.test.ts](../../../../src/resources/resource-tenant-database-crud.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-field-access.integration.test.ts](../../../../src/resources/resource-field-access.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/resources/resource-physical-tenant-boundary.test.ts](../../../../src/resources/resource-physical-tenant-boundary.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/framework/resource-policy.md](../../../../docs/framework/resource-policy.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Transport exposure is not loading mode; publicReadUserWrite isn't automatic cross-tenant sharing. Standalone low-level policy evaluation can omit managed Guardian context only for narrow legacy composition; managed multi mode fails closed. UI role/options do not prove backend policy. Owner fields/Guardian membership IDs differ and need distinct examples.

## Known Future Plans

Planned plugin/resource ergonomics and downstream policy expansions should use existing extension primitives; no new authorization DSL invented by docs.

## Navigation And Cross-Link Plan

The [system entrance](../../../backend/resources/index.md), configuration and
roadmap guides now exist. The feature matrix links each first-draft home;
source/example/artifact review remains separate.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [ ] Whole-platform reconciliation complete.
- [ ] Important examples and artifact/package support qualified.
- [x] First-draft authoritative guides exist for every inventoried group (review/qualification pending).

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
