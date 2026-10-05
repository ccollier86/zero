---
id: zero.inventory.data-studio
type: inventory
audience: [maintainer, agent]
owner: data-studio
status: in-review
visibility: internal
system: data-studio
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

# Data Studio Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Data Studio provides organization-scoped, user-defined logical tables, versioned schemas and typed row values inside a configured Fabric tenant database. It uses fixed framework-owned storage tables plus safe codecs/query handlers, not arbitrary user SQL or on-demand physical CREATE TABLE statements. The frontend DataStudio component is a distinct presentation contract.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A Data Studio **table** is a logical schema and row set stored in fixed
framework-owned tenant tables. A **schema revision** is an immutable historical
snapshot; a **row revision** supports optimistic mutation. The feature bundle
installs exact app/client tables, Resources, Fabric realm handlers, permission
fragments, and a router—it does not grant roles or execute arbitrary SQL.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Feature bundle and managed installation | createDataStudioFeature() from @zero/framework/data-studio/server | appTables/tables/clientTables/resources/realmContribution/permissions/roleFragments/router form one explicit bundle | [Draft guide](../../../backend/data-studio/installation.md) |
| Public/shared and server import split | @zero/framework/data-studio and /data-studio/server | Browser-safe schemas/codecs/errors versus privileged service/realm/router composition | [Draft guide](../../../backend/data-studio/public-api.md) |
| Required application profile | Guardian multi + advanced RBAC; Fabric multiple + tenant-database | Installation validator checks complete official resource/table/realm handlers; not activated by matching table names alone | [Draft guide](../../../backend/data-studio/profiles.md) |
| Organization-kind authority | Tenant permissions, resource policy and DataStudioService | Current administration and customer organizations use own database; cross-org authority remains separate | [Draft guide](../../../backend/data-studio/permissions.md) |
| Tenant-scoped permission and role fragments | data-studio:read/write/manage; viewer/editor/manager fragments | Fragments must be deliberately merged into declared role/permission registries | [Draft guide](../../../backend/data-studio/permissions.md) |
| Table identity, metadata and catalog | listTables/getTable/createTable/updateTable/setTableStatus | Immutable key, mutable label/description, active/archive states, row count and optimistic revisions | [Draft guide](../../../backend/data-studio/tables.md) |
| Schema language and validation | DataStudioSchema version 1; stable columnId/key/label/type/required/defaultValue | text/number/boolean/date/datetime/json; order, normalization, duplicate and boundary checks | [Draft guide](../../../backend/data-studio/schemas.md) |
| Schema history | listSchemaVersions and stored immutable schema snapshots | schemaRevision increments only on schema change; bounded retention/count and history | [Draft guide](../../../backend/data-studio/schema-history.md) |
| Canonical cells and missing/null semantics | normalize/encode/decode schema/row/value public codecs | JSON-safe normalized values and typed filter projections; absence versus null distinct | [Draft guide](../../../backend/data-studio/values.md) |
| Row read/write operations | listRows/getRow/createRow/replaceRow/deleteRow | Complete value maps, schema validation and optimistic row revision; no arbitrary cell SQL | [Draft guide](../../../backend/data-studio/rows.md) |
| Filtered, sorted and searched pages | DataStudioRowQuery: typed filters, search, sort, limit/offset | Backend filtering/projection, max bounds, stable order and byte-aware continuation | [Draft guide](../../../backend/data-studio/queries.md) |
| Idempotency and commit outcome | Operation IDs, expectedRevision, typed operation results | Actor mutation receipt replay, conflict versus committed/outcome-unknown handling | [Draft guide](../../../backend/data-studio/concurrency.md) |
| User and membership ownership | Guardian shallow user/membership foreign-key anchors in tenant realm | Write authority and ownership revalidated; canonical profile/login data stays system-owned | [Draft guide](../../../backend/data-studio/ownership.md) |
| Declarative resources and realtime | Official catalog full-sync and row lazy resources | Row field-policy validation and synchronized visible catalog/record changes; query IDs do not equal whole cache | [Draft guide](../../../backend/data-studio/realtime.md) |
| Actor realm queries and commands | data-studio.tables.*, data-studio.rows.*, schema-versions list | Registered trusted synchronous Fabric handlers, JSON-safe IPC, separate per-db writer/readers | [Draft guide](../../../backend/data-studio/realm-integration.md) |
| HTTP endpoint adapter | createDataStudioRouter; /api/_zero/data-studio | Thin defineRouter endpoints, validated params/body, current auth/services; automatically mounted on complete feature installation | [Draft guide](../../../backend/data-studio/http-api.md) |
| Operational limits | Service defaults and public schema/value constants | Quota/byte-budget/offset/filter/search ceilings are not unbounded UI-only hints | [Draft guide](../../../backend/data-studio/limits.md) |
| Domain errors and observability | DataStudioError and normalized database/HTTP failures | Stable codes, safe messages, outcomes and sanitized emitted context | [Draft guide](../../../backend/data-studio/errors.md) |
| Frontend editor and management composition | DataStudio/hooks; shared DataTableView/ListDetailLayout action bar | Search-first gooey control toolbar, schema editing, inline row edits, revision/pending/conflict state | [Draft guide](../../../backend/data-studio/frontend-integration.md) |

## Public Surface Map

- `@zero/framework/data-studio` is the browser-safe/shared contract: schema and
  value types/codecs/bounds, errors, permission and role fragments, client/app
  table definitions, and fixed tenant schemas.
- `@zero/framework/data-studio/server` adds `createDataStudioFeature`, the realm
  contribution/Resources, `createDataStudioRouter`, `DataStudioService`, its
  data+actor construction types, operation names, and hard service limits.
- The immutable feature bundle contains `appTables`, `tables`, `clientTables`,
  `resources`, `realmContribution`, `permissions`, `roleFragments`, and
  `router`. Managed `createApp` detects a complete official installation and
  mounts `/api/_zero/data-studio`; partial or altered fragments fail admission.
- The client-safe root and component subpath expose Data Studio transport/hooks/
  editor composition. UI capability flags are projections of server authority,
  not a substitute for Resource/Guardian/Fabric enforcement.

## Configuration Inventory

| Input / limit | Accepted value / default | Timing and interactions |
| --- | --- | --- |
| `createDataStudioFeature()` | no arguments; immutable bundle | Trusted construction; spread official fragments into application/realm/client configuration. There is no generic `dataStudio: true` flag. |
| `auth.tenancy.mode` / `auth.authorization.mode` | multi / advanced required | Startup installation admission; declared permissions and actor membership still govern each operation. |
| `databaseTopology` | multiple, tenantIsolation tenant-database required | Every organization uses its own configured realm database; system metadata separate. |
| Official `appTables/tables/resources/realmContribution/clientTables` | exact bundle fragments | Complete table schema/resource classifications and command/query handlers are validated. Router not normally mounted manually in createApp. |
| Permission/role registries | explicit merges of provided registry/fragments | Fragments are not independent grants; API keys inherit effective scope/ceilings. |
| `DataStudioServiceOptions` | `data: AsyncDatabaseClient`, `actor: {userId, membershipId}` required | Trusted service construction; no quota options or arbitrary tenant selector. |
| `DATA_STUDIO_MAX_TABLES` | 100 | Hard format/service bound; not a constructor setting. |
| `DATA_STUDIO_MAX_ROWS_PER_TABLE` | 100000 | Hard same-transaction count admission bound. |
| `DATA_STUDIO_MAX_SCHEMA_VERSIONS` | 256 | Hard version-history bound. |
| `DATA_STUDIO_MAX_PAGE_SIZE` / `DATA_STUDIO_DEFAULT_PAGE_SIZE` | 25 each | Query default/ceiling; row result byte budget can shorten a page. |
| `DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE` | 10 | Hard schema-history page ceiling. |
| Result byte budget | 768 KiB | Ordered rows and nextOffset reflect byte-limited inclusion, not an invented full page. |
| Schema bounds | 128 columns; schema 64 KiB | Public constants; stable columnId/table key/column key max64, label120, description500 characters. |
| Value bounds | cell64 KiB; aggregate row256 KiB; depth32; nodes4096; collection entries1024 | Canonical codecs reject invalid/malicious payloads before persistence. |
| Row query | search max200 characters; serialized filters max8192 bytes; offset max100000 | Filters eq/ne/gt/gte/lt/lte/contains; scalar operands and declared column types; sort asc/desc. |
| Mutation inputs | operationId; expectedRevision for replacement/update/delete paths | Receipt identity and optimistic conflict contract; exact required forms documented per operation. |

No provider/env secret or arbitrary SQL execution setting is needed. Shared
codec and operation constants are hard bounds, not configurable service options.
Managed installation must be explained with actual fragment names and public
server imports; no placeholder role grant makes installation or authority valid.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

The feature contributes fixed row/schema/history/cell tables, resources, trusted queries and commands to the tenant realm. System Guardian resolves the live actor and active organization; the request obtains a tenant-bound Fabric client with authority fences. Actor-side writes validate schemas, identities, revisions and quotas inside tracked transactions; shallow user/membership anchors enable foreign keys without duplicating profiles or credentials. API queries return typed projections plus truthful byte-aware pagination. Reactive changes feed resource sync and client caches; the editor controls must not use raw SQL, fabricate permission flags, or lose organization/request boundaries.

## Evidence And Verification

Implementation, both Data Studio package subpaths, fixed bounds, and managed
installation admission were inspected. The directory contains 11 test files;
none was run in this inventory review.

- [src/data-studio/index.ts](../../../../src/data-studio/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/server.ts](../../../../src/data-studio/server.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-feature.ts](../../../../src/data-studio/data-studio-feature.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-installation.ts](../../../../src/data-studio/data-studio-installation.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-contracts.ts](../../../../src/data-studio/data-studio-contracts.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-service-contracts.ts](../../../../src/data-studio/data-studio-service-contracts.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-service.ts](../../../../src/data-studio/data-studio-service.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-router.ts](../../../../src/data-studio/data-studio-router.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-access.ts](../../../../src/data-studio/data-studio-access.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-realm-contribution.ts](../../../../src/data-studio/data-studio-realm-contribution.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-row-query-sql.ts](../../../../src/data-studio/data-studio-row-query-sql.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-app.integration.test.ts](../../../../src/data-studio/data-studio-app.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-router-runtime.test.ts](../../../../src/data-studio/data-studio-router-runtime.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/data-studio/data-studio-realm.integration.test.ts](../../../../src/data-studio/data-studio-realm.integration.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/data-studio.md](../../../../docs/data-studio.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Do not equate logical Data Studio table creation with physical schema migrations or an administrative SQLite console. Administration-organization support exists in the current policy and tests; historical customer-only reports must not be copied as the current contract. The exact feature-bundle example, resource/realm parity, API-key and mixed-role checks, concurrent revision conflicts, query-byte continuation and packaged UI interaction still need focused qualification.

## Known Future Plans

User-requested direction: reusable modern inline management for organization-created durable function/workflow data; broader admin console uses as permissioned composition. Optional future arbitrary database administration must be designed separately rather than inferred from this logical-table feature.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/data-studio/index.md`, `configuration.md` where relevant, and
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
