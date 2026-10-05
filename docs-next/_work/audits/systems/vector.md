---
id: zero.inventory.vector
type: inventory
audience: [maintainer, agent]
owner: vector
status: in-review
visibility: internal
system: vector
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

# Vector Store Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Vector owns named local vector indexes, scalar/JSON metadata, similarity and filtered queries, adapter lifecycle, and AI embedding composition. Its current zvec-backed service is server-side and separately persisted. It does not currently provision organization-owned stores or supply a packaged vector-management UI; a scoped filter wrapper is not automatic Guardian integration.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

A vector **index** is a named local zvec collection with one fixed vector shape
and promoted scalar metadata schema. `VectorService` owns validated operations,
`VectorRegistry` owns lazy index instances, and `VectorScope` stamps/filters
trusted required metadata. A scope narrows data access but does not authenticate
or authorize its caller.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Canonical draft guide |
| --- | --- | --- | --- |
| Managed and standalone plugin | createApp vector settings; createVectorPlugin/getVectorStore; @zero/framework/vector | Lazy collection opening and app-local runtime service/cleanup; compatibility getter can be ambiguous | [Draft guide](../../../backend/vector/composition.md) |
| Registry and pluggable index storage | VectorRegistry, VectorIndexStore, ZvecAdapter | Named index lookup/cache and explicit open/dispose ownership; native provider deployment qualification | [Draft guide](../../../backend/vector/adapters.md) |
| Dense vector record writes | VectorService.upsert; number[]/Float32Array embeddings | Dimension/finite value checking, IDs, text and app metadata, batched adapter writes and per-record issues | [Draft guide](../../../backend/vector/records.md) |
| Similarity search | query/search with vector, topK, minScore, includeVector and outputFields | Distance/index-family/provider semantics, bounded request validation and scores | [Draft guide](../../../backend/vector/queries.md) |
| Scalar-only queries and safe filters | VectorFilter, build/merge filter helpers, query without embedding | Known indexed fields and safe scalar encoding; logical $and/$or and operator handling | [Draft guide](../../../backend/vector/filters.md) |
| Fetch by identity | fetch/get with selected output fields | ID validation, includeVector opt-in, normalized stored metadata/text | [Draft guide](../../../backend/vector/records.md) |
| Delete and deleteWhere | VectorService deletes IDs or scalar-filtered records; VectorScope exposes deleteWhere only | Scope AND-filter enforcement and partial provider issue results; no scoped delete-by-ID wrapper | [Draft guide](../../../backend/vector/deletes.md) |
| Required metadata scopes | VectorService.scope and VectorScope | Read/delete filters AND required equality metadata; writes stamp required values; caller extra filters cannot widen scope | [Draft guide](../../../backend/vector/scopes.md) |
| Index configuration and metadata promotion | Named dimensions/metric/indexType, promoted scalar fields and JSON backup | Metadata type/name/collision checks; indexed scalar fields versus full app metadata | [Draft guide](../../../backend/vector/indexes.md) |
| Query-time tuning | ef/nprobe/listSize/linear/radius | zvec family-specific options, no universal performance promise | [Draft guide](../../../backend/vector/tuning.md) |
| Statistics and health | stats/status/getStatus/list/listIndexes | Index/dimension/document count/completeness and internal path; safe admin projection required | [Draft guide](../../../backend/vector/operations.md) |
| Optimization and lifecycle | optimize/dispose, plugin runtime cleanup | Explicit collection lifecycle, await cleanup; not a distributed vector server | [Draft guide](../../../backend/vector/operations.md) |
| AI text embeddings | createAIVectorBridge embedText/embedAndUpsert/embedAndQuery | Uses configured Zero AI models, dimensions and index scope; providers billed independently | [Draft guide](../../../backend/vector/ai-integration.md) |
| Multi-document bridge composition | embedAndUpsertMany | Current bridge loops ai.embed then vector upsert; not an embedMany provider batch throughput guarantee | [Draft guide](../../../backend/vector/ai-integration.md) |
| Domain errors and telemetry | VectorError, VECTOR_* observability codes | Safe application presentation separate from provider failures; app-runtime isolation qualification | [Draft guide](../../../backend/vector/errors.md) |

## Public Surface Map

- `@zero/framework/vector` is server-only and exports configuration resolution,
  `VectorError`, plugin/getter, `VectorRegistry`, `VectorService`, `VectorScope`,
  `ZvecAdapter`, the AI bridge, safe filter helpers, and operation/config types.
- Managed `createApp` exposes the app-local service to trusted server
  composition and awaits disposal. There is no vector HTTP router, browser SDK,
  hook, management component, tenant-provisioning API, or Fabric-backed vector
  realm in the inspected package.
- `VectorScope` is the app-facing narrowing primitive: writes receive required
  metadata and reads/filter-deletes are AND-scoped. The app must derive that
  scope from verified live Guardian authority; arbitrary trusted metadata is
  not self-authenticating.
- `createAIVectorBridge` composes the configured AI embedding service with a
  vector service/scope. It does not merge provider configuration or make the
  vector index dimensions adapt to a selected model.

## Configuration Inventory

| Path | Type / default | Origin, timing and interactions |
| --- | --- | --- |
| `vector` | omitted/false disabled; true defaults; VectorConfig object | Configuration resolution; managed plugin added only when enabled. |
| `vector.dataDir` | string; ./data/vector | **ZERO_VECTOR_DATA_DIR overrides config.dataDir**; then default. Startup-resolved path, server-only. |
| `vector.defaultIndex` | name; default | Must exist among configured indexes; trimmed safe name. |
| `vector.defaultDimensions` | positive integer; 1536 | Config, then parsed ZERO_VECTOR_DEFAULT_DIMENSIONS, then default. Embedding model dimensions must agree. |
| `vector.indexes` | name→number or object; default index when absent/empty | Number shorthand sets dimensions. Names and reserved field collisions validated. |
| `vector.indexes[name].dimensions` | positive integer; resolved defaultDimensions | Native collection shape; not silently changed by selecting another embedding model. |
| `vector.indexes[name].path` | string; dataDir/indexName | Per-index explicit path; server persistence root, not client output. |
| `vector.indexes[name].vectorField/textField/metadataField` | strings; embedding/text/_metadata | Safe names and no duplicate/reserved scalar field collisions. |
| `vector.indexes[name].metadata` | field→string/number/boolean shorthand or object | Default fields namespace/bucket/tenantId/ownerId/userId/source/type/version/createdAt/updatedAt are strings. Overrides merge. |
| `metadata[field].type` | string/number/boolean required | Indexed scalar promotion; arbitrary full metadata stored separately as JSON. |
| `metadata[field].indexed/nullable/range` | boolean; true each | Adapter schema/query capability; field definitions are startup configuration. |
| `vector.indexes[name].metric` | cosine/ip/l2; cosine | Provider distance semantics. |
| `vector.indexes[name].indexType` | hnsw/flat/ivf/diskann; hnsw | Native index support/performance must be qualified per deployment. |
| `vector.indexes[name].readOnly` | boolean; false | Provider write admission. |
| `vector.indexes[name].enableMMAP` | boolean; true | Local collection I/O setting. |
| `vector.indexes[name].insertBatchSize` | positive integer; 250 | Adapter bulk upsert batching, not embedding-provider batching. |
| `vector.indexes[name].query` | ef/nprobe/listSize numbers, linear boolean, radius number; {} | Default query tuning merged with explicit per-call options. |
| Per-call query | vector optional, topK/filter/minScore/includeVector/outputFields/query | Service runtime request; declared filters and provider family constrain semantics. |
| `scope(requiredMetadata)` | equality metadata map | Trusted binding supplied by app; application must derive org/user identity and live permission authority. |

There is no database-backed provider/index catalog or organization self-service
vector setting. No public vector HTTP router is installed by the plugin.
Native collection compatibility and environment precedence are source-observed,
not a guarantee for all host architectures.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

createApp resolves vector settings and registers VectorService in the app runtime. VectorRegistry lazily opens index stores; calls validate embeddings, metadata and filters before adapter execution. AI bridge delegates embeddings to Zero AI and submits normalized records/queries. VectorScope adds required equality metadata to writes and ANDs filters on reads/deletes; it does not authenticate a caller or resolve a tenant automatically. Apps exposing vector operations must derive scope from verified current Guardian authority and uphold the app's service boundary. Vector indexes are not Fabric SQL databases or ReactiveDB change logs, so SQL resource/state synchronization is not implicit. Await service disposal during runtime cleanup and keep paths/unsafe diagnostics server-owned.

## Evidence And Verification

Implementation and the complete vector subpath barrel were inspected. The
directory contains six test files across config/filter/service/AI/plugin/runtime
behavior; none was run in this inventory review.

- [src/vector/index.ts](../../../../src/vector/index.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-types.ts](../../../../src/vector/vector-types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-config.ts](../../../../src/vector/vector-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-service.ts](../../../../src/vector/vector-service.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-registry.ts](../../../../src/vector/vector-registry.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/zvec-adapter.ts](../../../../src/vector/zvec-adapter.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-filter.ts](../../../../src/vector/vector-filter.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-ai-bridge.ts](../../../../src/vector/vector-ai-bridge.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector.plugin.ts](../../../../src/vector/vector.plugin.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-error.ts](../../../../src/vector/vector-error.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-observability.ts](../../../../src/vector/vector-observability.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-service.test.ts](../../../../src/vector/vector-service.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-filter.test.ts](../../../../src/vector/vector-filter.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector-ai-bridge.test.ts](../../../../src/vector/vector-ai-bridge.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/vector/vector.plugin.test.ts](../../../../src/vector/vector.plugin.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/vector.md](../../../../docs/vector.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

### Authorized Post-Baseline Correction

The original resolver accepted invalid metric/indexType strings from JavaScript
config, and the adapter silently chose cosine/HNSW fallbacks. Focused config
tests reproduced this (6 pass/2 fail), then the resolver was corrected to reject
invalid enum values with `VECTOR_CONFIG_INVALID`. All valid combinations remain
unchanged. `bun --no-env-file test src/vector/vector-config.test.ts
src/vector/vector-filter.test.ts` passed 15/15 checks, 61 assertions. This is
working-tree evidence after the original pinned source inventory, not an
archive/release qualification; no native index or provider was invoked.

Data-dir precedence differs from configuration-first storage and dimension settings; document the actual rule rather than inventing a platform-wide env precedence. The bridge's current multi-document embedding path is sequential composition, not batched embedMany. Organization-owned provisioning, automatic authorization, realtime result subscriptions and a management UI have not been established as current exports. No implementation defect is established by those absent proposals; native/deployment and provider integration remain unqualified in this audit.

### Authorized Scope Integrity Correction

Root's synthetic regression proved that a scoped upsert could replace an existing
record in another metadata scope by guessing its ID: 4 tests passed, 1 failed,
15 assertions. A metadata-stamping-only wrapper did not check prior ownership.

The working correction performs full candidate-scope validation and existing-ID
preflight within one same-service per-index write boundary, shared by ordinary
upsert, ID delete, filter delete and optimize. It does not merely mutex the
fetch. Independent indexes remain concurrent. Scope filters and queued records
are detached; null equality stamping is consistent. Idle entries retire and
failed preflight/adapter calls release following work. Disposal rejects new
intake and drains admitted reads/writes before closing stores.

Admission is internally bounded at 128 pending writes per index and 1,024
active operations across the service, including reads and queued writes. An
overflow rejects with the value-free `VECTOR_BACKPRESSURE` code and only the
capacity category (`index` or `service`), before copying an incoming upsert
payload. These are internal fixed limits, not new AppConfig settings or a
record-byte/RAM quota. Counting service capacity does not serialize different
indexes. Both successful and failed operations release capacity.

`VECTOR_SCOPE_CONFLICT` carries a value-free message. Invalid/cyclic filter data
is `VECTOR_FILTER_INVALID`; rejected post-disposal operations are
`VECTOR_OPERATION_FAILED`. Standard vector observability remains in use; no
record IDs, scope values, text, embeddings or payloads were added to metadata.
The added queue/snapshot helpers are internal, not new public service methods.

Final focused command on 2026-10-05: service, controlled concurrency, filters,
operation-boundary, config, fake AI bridge and plugin suites passed 39 tests /
142 assertions.
The controlled cases prove competing empty-ID scopes, ordinary-writer ordering,
both delete modes, candidate batch rejection, input detachment, failure progress,
independent indexes, read/write drain, idle cleanup and safe cyclic/null scope
behavior, per-index/service saturation, cross-index progress while saturated,
pre-copy rejection, capacity release after failures, and bounded drain. Only
synthetic adapters/explicit config values were used: no native
zvec, providers, existing data or filesystem collections were opened.

This is uncommitted dirty development evidence after the original clean source
inventory. It is neither Guardian authorization nor distributed atomicity
across different services/processes/native handles. Raw adapter writes remain
trusted escape hatches; backend policy must derive scope from live authority.
Native multi-record writes can still report partial provider issues; the
preflight guarantee is not a newly promised native batch transaction.

### Supplemental App-Local Telemetry And Startup Ownership

Synthetic managed composition reproduced ambient vector telemetry redirection
and an unowned callback-failure cleanup (0 passed, 2 failed). The working
plugin now captures its app observability runtime and passes an emitter to
its newly constructed service/registry/default adapter. Operation, configured,
index-ready and index-failure events stay with that owner despite later
ambient configuration. Standalone construction retains its compatibility
default or accepts an explicit emitter. A supplied prebuilt service/custom
store retains caller-owned telemetry; it is not silently retargeted.

Cleanup is registered before publishing the service or invoking
onServiceCreated. Publication failure begins the shared cleanup immediately,
reports only sanitized cleanup failure metadata, and throws stable
VECTOR_CONFIG_INVALID without callback content. Managed runtime disposal can
await the same cleanup. Existing service disposal ownership remains unchanged.
VectorServiceOptions is an additive public construction type on /vector;
no global runtime setting or browser endpoint was added.

Final synthetic vector command on 2026-10-05 (the prior seven suites plus
vector-runtime-isolation) passed **44 tests / 163 assertions**. Lazy adapter
checks use a native-shaped synthetic module or rejected synthetic loader,
never the native driver or a persisted vector collection. Managed event
ownership/publication tests use in-memory stores and local Elysia lifecycle
only. These are dirty development corrections, not release qualification.

An explicitly supplied runtime must already own an observability runtime;
missing that dependency rejects before vector construction/publication. This
matches managed createApp ownership and prevents a managed-looking composition
silently falling back to a sibling app's ambient store. Omitting runtime keeps
the documented standalone compatibility path.

## Known Future Plans

User requested future investigation of organization-owned vector stores, chunks plus metadata, and optional GraphQL/vector composition. Live model/dimension/capability catalogs and improved AI batching are candidate expansions, not implemented configuration or a promised release.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/vector/index.md`, `configuration.md` where relevant, and
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
