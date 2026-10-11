---
id: zero.vector-visualization-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: vector
status: draft
visibility: internal
system: vector
feature: ingestion-search-visualization
maturity: supported
applies_to: ["2.6.0 unreleased implementation and remaining qualification notes"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric, external-engine, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-09"
  evidence_level: source-observed
---

# Ingestion and Vector Search Visualization Plan

[Working evidence](./index.md) · [Component roadmap](../frontend/components/roadmap.md) · [Vector roadmap](../backend/vector/roadmap.md)

Build composable ingestion and vector-search organisms with a complete Zero API
facade, real operation state and reusable presentation. Zero-native integration
is the primary path. External engines can supply the same presentation through
an adapter, and an explicit story mode can support landing pages without live
search or ingestion.

The supplied **Ingestion Pipeline.html** and **Vector Search.html** define the
visual references. Their stage controls, readouts, dividers and result panels
are part of the intended component, not disposable demo chrome. The separate
[design-token plan](./design-token-theme-evolution-plan.md) captures that direction
for the later default-theme redesign. Complete these components first.

The implemented facade is documented in the
[backend guide](../backend/vector/visualizations.md) and
[component guide](../frontend/components/vector-visualization.md). This plan
retains the rationale and qualification boundaries; it is not the API reference.
Review any subsequently supplied JavaScript variant before adding new behavior.

## Existing Zero Foundations

| Responsibility | Foundation to reuse | Work still needed |
| --- | --- | --- |
| Embeddings and model reranking | AIService embed/embedMany/rerank, configured providers, limits, cancellation and telemetry | Correlate operation/chunk identities and publish safe stage receipts. |
| Vector persistence and retrieval | VectorService, VectorScope, stable record IDs, metadata and native zvec indexes | Authorized client APIs, map snapshots and explicit engine capabilities. |
| Durable ingestion | Torrent workflow runs, attempts, retries, idempotency and authority | Document/chunk domain coordination and recovery across vector and relational stores. |
| Live progress | ReactiveDB, existing Sync transport and workflow hooks | Safe visualization records and bounded live updates with correct database placement. |
| Browser integration | Existing authenticated SDK, hooks and scope retirement | Small ingestion/search controllers and tool-operation bindings. |
| Presentation | Semantic theme tokens, DenseList, controls, tooltips and existing motion patterns | Shared visualization pieces and the two organism compositions. |

Source entry points: [AIService](../../src/ai/ai-service.ts),
[vector service](../../src/vector/vector-service.ts),
[vector contracts](../../src/vector/vector-types.ts),
[AI/vector bridge](../../src/vector/vector-ai-bridge.ts),
[workflow contracts](../../src/workflows/types.ts),
[reactive workflow hook](../../src/frontend/client/workflow-hooks.ts), and
[ReactiveDB](../../src/sync/reactive-db.ts).

Native vector writes do not automatically become ReactiveDB changes. Scope
helpers do not automatically route vector collections through Fabric. Define
the authority, placement and publication boundary explicitly; do not invent a
second websocket, provider registry, authentication client or workflow engine.

## Shared Components and Facade

Compose both organisms from a stage/progress rail, document/chunk preview,
embedding diagnostic strip, metadata/readout panel, vector-map renderer and
ranked-results list. Reuse existing controls and DenseList slots where they fit;
introduce only missing domain presentation and animation behavior.

Separate these layers:

1. Server services own ingestion/search execution, validation, authorization and
   acknowledged writes. Thin Elysia routes expose their bounded contracts.
2. The SDK owns authenticated commands, cancellation, snapshots and subscriptions.
3. Hooks/controllers turn operation state into a stable UI model and retire stale
   operations after supersession, unmount, sign-out or tenant changes.
4. Presentational pieces render supplied state. Organisms assemble those pieces
   and offer controlled customization without making rendering a persistence step.

The public facade should cover start/attach/observe/cancel where meaningful,
accepted results, operation identity, readiness and errors. Separate optional
presentation pause/replay/seek from actual execution control. Publish typed
adapter contracts and capabilities rather than callbacks with undocumented shapes.

## Presentation Modes

- Full application panels expose the map, stage strip and synchronized details.
- Compact inline presentation fits chat messages, tool activity and agent feeds.
- An expanded inspector exposes additional authorized diagnostics.
- Public story/landing presentation uses explicit fixtures or supplied public
  data, with optional loop/playback controls and no implicit provider requests.

Configuration can enable the capability and select default presentation, with
per-instance overrides. Scope-sensitive data remains authorized by the server,
regardless of presentation. Hiding a widget is not an authorization decision.

## Search Contract

Support vector retrieval and true hybrid retrieval, each with or without an
optional reranker. Hybrid retrieval needs independent lexical and dense candidate
sources plus a defined fusion stage. The reference's candidate-local keyword
blend is a reranking demonstration, not full-corpus hybrid retrieval.

Render stages that actually execute. A no-rerank search may display final ordering
without claiming a model reranker ran. Keep dense, lexical, fused and reranker
scores distinguishable, including metric, direction and provenance. Do not assume
every engine distance becomes similarity through `1 - distance`.

Candidate and final ordering come from authoritative responses, correlated by
stable IDs. Bound visible rows while retaining the full accepted result contract;
the reference's eight-candidate/five-result limits are not permanent API ceilings.

Search results become usable when the backend finishes. Presentation may animate
their arrival and ranking, but cannot impose the reference's approximately
12-second in-app story or make paused motion block a tool call's completion.

## Ingestion Contract

Observe document acceptance, actual splitting, embeddings, enrichment and vector
write acknowledgements. Model chunk IDs, source-coordinate spans, attempts,
revisions and stage timestamps explicitly. Token counts must identify their
tokenizer or their approximate status.

Support batches and parallel chunks without portraying a visually serialized
queue as the backend's execution order. Stable chunk IDs and idempotency keys
prevent retries or reconnects from producing duplicate records or counters.

Only an acknowledged write may count as stored/indexed. Distinguish storage
acceptance from search readiness when an engine exposes them separately. Recover
partial writes through durable receipts and reconciliation; native vector and
relational progress stores must not be described as one atomic transaction.

Progress needs explicit queued, active, waiting, failed, cancelled and completed
states, with safe errors and retry behavior. Pausing, hiding or unmounting the
visual must not prevent backend completion or leave application promises pending.

Replace the reference's no-op external `chunked` method and animation-owned local
index insertion with functioning state contracts. Handle empty indexes/documents,
missing embeddings, dimension mismatches, retries and update/delete/reindex flows.

## Initial Map and Live Changes

Seed the scene from a bounded, authorized sample of real stored records. Include
stable IDs, allowed titles/source metadata, cluster labels, projection coordinates
and optional neighbor relationships. Include returned candidate IDs when a search
needs points outside the original display sample.

Persist or retain a versioned projection transform shared by documents and queries.
Do not refit, recenter or rotate all existing points on every operation. Review
projection recomputation as an explicit transition with stable identity.

Keep vectors server-side by default; expose only permitted diagnostic values when
needed. Redact text and metadata explicitly: vector output-field selection alone
is not an API security allowlist. Corpus/run counts must have a defined scope;
an underlying shared-index total is not a tenant total.

Use snapshots plus ordered updates with operation, chunk, attempt and revision
identity. Reconnect restores current accepted state and deduplicates deliveries.
Choose application/tenant database placement through Zero's existing topology
contracts for both normal and Fabric deployments.

## Trace and Engine Capabilities

The current Zero vector adapter exposes result records, not native visited-node
sequences or HNSW topology. The references build local nearest-neighbor graphs
and HNSW-like walks; these are not native engine traces.

Define separate capabilities for actual operation stages, graph relationships,
native traversal, projection metadata and results. Investigate engine-level
instrumentation where supported. Real traces must use actual backend receipts;
other engines can show actual candidates/relationships or explicitly illustrative
paths. Never fabricate compute counts, traversal order or corpus-wide recall.

Projection-neighbor preservation, sample-level diagnostic checks and measured
retrieval quality are different values and need distinct labels. First-coordinate
bars are vector diagnostics, not semantic feature-importance explanations.

## Chat and Agent Binding

An enabled chat/tool integration can mount the search visualization when the
existing search tool begins. It attaches to that operation's ID rather than
starting another request. Agent activity views can attach in the same way,
including multiple concurrent operations without mixing their results.

Completion remains available to the assistant immediately; the visualization may
settle, collapse into a summary or remain inspectable independently. Late mounts
recover from a snapshot. Restart, cancellation, tenant switch and revoked authority
retire the correct instance. Do not publish hidden reasoning, private prompt data
or unrestricted provider payloads as visual diagnostics.

## Implementation Sequence

- [x] Freeze the source-backed facade, engine capabilities, domain records and
  event identities after reviewing any additional reference variant.
- [x] Implement server orchestration, authorized APIs, safe projections and
  explicit provisioning/placement using existing Zero services.
- [x] Implement true hybrid retrieval/fusion and optional existing AI reranking,
  with independent configuration and score provenance.
- [x] Add map sampling/projection metadata and safe selection/snapshot endpoints.
- [x] Add SDK/controllers/hooks with reconnect, cancellation and authority retirement.
- [x] Build the shared presentational pieces and both organisms using existing
  tokens; record anatomy/token mappings in the design-token plan as work proceeds.
- [x] Add operation-ID observer bindings for chat/tool/agent consumers and explicit
  external-engine/story adapters; no chat provider or tool is rewritten automatically.
- [x] Verify lifecycle, errors, retry/recovery, scopes, performance, accessibility,
  reduced motion, responsiveness, SSR and packaged exports/styles.
- [x] Write professional component/API/configuration/integration guides and
  examples, including migration or Doctor guidance where applicable.
- [x] Review and polish remaining gaps before beginning the wider theme redesign.

## Completion Gates

Qualify all four retrieval/rerank combinations; real seeded maps; concurrent and
superseded searches; out-of-order chunks; failures and partial writes; empty and
small datasets; retry/reconnect/reload; scope changes and revoked access; and
snapshot/live-update coherence under normal and Fabric topology.

Verify long text, compact/full/inspector modes, keyboard-accessible results and
details, accessible state announcements, real reduced motion and observer cleanup.
Bound projection and graph work; perform expensive calculations outside the main
render loop. No default download of the whole vector corpus is acceptable.

Route backend/frontend lifecycle and failures through Zero errors, OBS_CODES and
the established observability sinks. Keep operational logs separate from safe
domain progress records and exclude secrets, vectors and private text from logs.

Public imports, minimal configuration examples and package styles must work
without framework-private access. Mark completion only after implementation,
focused tests, review and documentation; this roadmap introduces no runtime API.

### Implementation Boundaries

- The feature is opt-in. SYSTEM progress/private projections use existing
  ReactiveDB writer operations and Sync; native records use a trusted discriminator
  and `VectorScope`, not unscoped shared-index totals or copied tenant tables.
- Direct HTTP execution does not resume itself after process failure. Bootstrap
  marks unfinished operations interrupted. Explicit Torrent activities supply
  durable workflow retry/authority semantics without inventing another scheduler.
- Ingestion is append-only source versioning. Automatic delete/replace/reindex
  and cross-store rollback are not claimed; applications own those policies.
- Empty/identical-vector projection frames may initialize when variance first
  appears; established frames remain stable until explicit refresh.
- zvec does not provide native traversal. Derived sample links and external
  trace capabilities are labeled separately; no fake HNSW metrics are published.
- The wider default-theme redesign remains next, not part of this implementation.

### Qualification Recorded on 2026-10-08

Focused tests cover the four retrieval/rerank combinations, exact owner/tenant
CAS, stale publication, acknowledged/unknown writes, projection persistence,
dimension/JSON bounds, workflow attempt fences and explicit public playback.
Managed application integration uses separate disposable application/SYSTEM
databases, the installed native engine and mock embeddings. It verifies accepted
ingestion, dense and independent lexical hybrid results, stable real-map
coordinates, owner-only HTTP/Sync snapshots, private projection exclusion and
no optional tables when disabled. No external provider or production deployment
was exercised.

Full-style browser fixtures qualify light/dark, 375px layouts, keyboard
inspection, stable rank nodes, scrolling/interruption, reduced motion and token
overrides. A React StrictMode fixture verifies synchronous selection masking,
stale cancellation rejection and observer cleanup. Public browser/server export
smokes, source-copy checks and the documentation graph check pass.

Review closed concrete native ID/projection incompatibilities, nested-parser
crashes, selection leakage, write-only corpus-map exposure and unbounded
high-dimensional neighbor work. Tenant predicates and actor-compatible stores
are qualified locally; this is not a production Fabric load-test or a native
vector-sharding claim. Full-repository TypeScript still reports four pre-existing
test-only errors outside this feature; targeted new-feature graphs are clean.

### Review Corrections on 2026-10-09

- [x] Replace the isolated optional migration registry with atomic fixed-schema
  admission that preserves all core migration versions and checksums. Qualify
  fresh/existing file-backed startup, restart, feature toggles and strict admission.
- [x] Claim operation execution atomically, preventing concurrent duplicate
  provider/native effects. Replay observers cannot displace the actual runner.
- [x] Drain pending admissions on disposal and include them in capacity limits.
- [x] Persist narrowly bound interrupted retirement after authority loss without
  exposing data to the revoked caller or overwriting terminal receipts.
- [x] Fence accepted client snapshots after synchronous subscription retirement
  and cleanly detach synchronous baseline-read failures.
- [x] Make incoming results/errors visible during presentation pause instead of
  freezing an entrance at zero opacity.
- [x] Capture query coordinates and the accepted map in the same projection frame.
- [x] Recheck hydrated records and scoped fetch/write preflight using the configured
  native text field, keeping scalar metadata named `text` distinct. Reject scalar
  filters on native FTS columns before engine dispatch.
- [x] Add keyboard/pointer inspection and controlled record/cluster selection for
  dots and geometric rings, plus query-marker inspection. Forward customizable
  React tooltip renderers through both organisms; preserve default and hide options.
- [x] Replace full-history Sync with atomically published fixed metadata signals.
  Keep older snapshots private and readable by ID, coalesce attached reads, and
  avoid refetching completed cards for unrelated feed events.

The expanded qualification includes real native custom-field retrieval,
metadata-only HTTP/Sync progress, atomically rolled-back feed failures, persistent
core bootstrap compatibility and actual geometric-ring pointer hit tests.
This remains an unreleased working-tree implementation, not a deployed production
Fabric load-test. Durable history is retained; operators must explicitly choose
any archival/deletion policy.

Final local qualification passed 334 tests across 37 files, including native
retrieval, managed HTTP/Sync, persistent bootstrap, browser interactions, public
exports, source-copy and actual documentation examples. The documentation graph
has 752 reachable pages and no structural problems. The repository-wide compiler
still reports the same four unrelated pre-existing test errors; the visualization
source and focused graphs are clean. Nothing was merged or deployed by this run.

## Related Work

- [Theme evolution](./design-token-theme-evolution-plan.md) records the complete
  information-panel reference and later default-theme sequence.
- [Vector roadmap](../backend/vector/roadmap.md) owns backend evolution and
  [AI integration](../backend/vector/ai-integration.md) describes current bridges.
- [Workflows](../backend/torrent/index.md) and
  [ReactiveDB](../backend/reactive-db/index.md) own execution and committed data.
- [Component roadmap](../frontend/components/roadmap.md) owns reusable UI,
  [DenseList](../frontend/components/dense-list.md) supplies row composition, and
  [design tokens](../frontend/design-system/tokens.md) supply current appearance.
