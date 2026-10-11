---
id: zero.vector.visualizations
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: ingestion-search-visualization
maturity: supported
applies_to: ["2.6.0 unreleased working tree"]
modes: [Guardian single, Guardian multi, standard-database, Fabric, external-engine]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-09"
  evidence_level: source-observed
---

# Authorized Vector Visualizations

[Vector overview](./index.md) · [Visualization components](../../frontend/components/vector-visualization.md)

Enable `vectorVisualization` to expose real search and ingestion progress through
Guardian-authenticated commands and Zero's existing Sync connection. The service
uses configured AI models, scoped native vector indexes and persisted operation
snapshots. A visual transition never starts work, acknowledges storage or delays
the availability of a completed search.

## Configure an authorized corpus

The feature is disabled by default. Enabling it requires Guardian, AI, a native
index and declared permissions. Existing vector records must contain the same
promoted scope discriminator that this feature uses; enabling the feature does
not adopt or disclose unscoped historical records.

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables: {},
  auth: {
    authorization: {
      permissions: {
        'knowledge:search': { label: 'Search knowledge', scope: 'application' },
        'knowledge:ingest': { label: 'Ingest knowledge', scope: 'application' },
      },
      roles: {
        user: { permissions: ['knowledge:search'] },
        admin: { permissions: ['knowledge:search', 'knowledge:ingest'] },
      },
    },
  },
  ai: true, // Configure an embedding alias whose output has exactly 384 dimensions.
  vector: {
    indexes: {
      knowledge: {
        dimensions: 384,
        lexical: true, // Actual full-corpus lexical retrieval for hybrid searches.
        metadata: { corpus_scope: { type: 'string', indexed: true, nullable: false } },
      },
    },
  },
  vectorVisualization: {
    defaultIndex: 'knowledge',
    indexes: {
      knowledge: {
        scopeField: 'corpus_scope',
        searchPermission: 'knowledge:search',
        ingestPermission: 'knowledge:ingest', // Omit for a search-only index.
        embeddingModel: 'embedding',
        rerankingModel: 'reranking',
        sampleSize: 96,
        metadataFields: ['title', 'source_label', 'source_abbreviation', 'cluster_id'],
        chunk: { maxChars: 1000, maxTokens: 512, overlapChars: 120, maxChunks: 128 },
      },
    },
  },
});
```

For Guardian multi mode, declare the permissions in the organization scope and
grant them to the appropriate organization roles. Scope metadata is stamped by
the server as `application` or `tenant:<validated tenant ID>`; neither commands
nor browser code can choose a tenant, native filter, database path or credential.
Visualized ingestion and its snapshots require both ingestion and search
permission because they can show existing corpus records alongside new chunks.
A write-only ingestion role must not receive a corpus map through this API.
Configure the embedding alias using [AI integration](./ai-integration.md).
Changing its output dimensions is an explicit index migration, not a UI setting.

`metadataFields` is a public diagnostic allowlist. Without `title`, result titles
fall back to record IDs. Add `text` only if short chunk excerpts may be disclosed
to authorized viewers. The ingestion document itself is visible to its owner.
Full embeddings and fitted projection axes remain server-side; snapshots expose
only a small embedding preview and projected coordinates.

## Database placement and admission

Progress lives in `vector_visualization_operations` on the SYSTEM plane, with
exact owner, validated scope and nullable tenant discriminators. Projection
artifacts live in the private `_vector_visualization_maps` table. This placement
is the same in standard and Fabric applications: it does not copy progress into
every tenant database. Native vectors remain in their explicitly configured
index and are narrowed through `VectorScope` before retrieval or writes.

Managed bootstrap admits the fixed optional schema in one ReactiveDB transaction
and uses the existing writer receipt infrastructure. The schema handler and
readiness inspection share one DDL catalog. Admission leaves the core migration
ledger and its checksums unchanged, so enabling the feature after provisioning
does not prevent a subsequent core bootstrap. Disabled applications do not
provision these visualization tables. With `migrate: false`, all required schema
and receipt objects must already be admitted; missing or conflicting objects
stop startup instead of silently repairing them. Doctor inspects readiness
without provider calls, native collection startup or database writes.

For manual provisioning, call `admitVectorVisualizationSchema(systemDb, true)`
on the application's owning SYSTEM ReactiveDB before strict startup. Do not add
`vector_visualization_001` to the managed core migration ledger. The exported
`vectorVisualizationMigration` handler is available to applications that own a
complete, separate migration registry; it is not a standalone registry to run
against Zero's core history.

Generic Sync carries only `vector_visualization_feed`: one small metadata row
per owner, scope, index and operation kind. Its opaque change token is updated
in the same writer batch as accepted progress. Tokens invalidate attached
snapshots; they are not ranks, timestamps or operation payloads. The SDK
coalesces changes into authenticated reads of the attached operation ID.
Reconnect reconciles that ID without downloading historical operation snapshots.

Full operation snapshots and private projections are excluded from generic
Sync and lazy reads. All three table names reject generic client writes and
application overrides, including while the feature is disabled. Feed delivery
and HTTP snapshot reads require the owner's current kind-specific corpus grant.
Turning the feature off revokes its public feed without deleting historical data.
Durable history remains readable by authorized operation ID and is not pruned
automatically. Long-running applications should define their own explicit
history-retention policy; native corpus records are never deleted by feed updates.

## Commands and observation

`AppProvider` reads the server feature manifest automatically. Vanilla clients
must pass `vectorVisualization: true` to `createClient` when the server enables it.

```ts
const visuals = client.vectorVisualizationFor('knowledge');
const accepted = await visuals.search!({
  text: 'How do I rotate a leaked API key?',
  retrieval: 'hybrid',
  rerank: true,
  topK: 5,
  candidateCount: 20,
  operationId: crypto.randomUUID(),
});

// Subscribe observes existing work. It never calls search again.
const stop = visuals.subscribe(accepted.id, snapshot => render(snapshot));
const baseline = await visuals.get(accepted.id);
// stop() detaches observation; cancel() explicitly requests backend cancellation.
await visuals.cancel!(accepted.id);
stop();
```

Search and ingestion commands return accepted snapshots with HTTP 202. Use the
controller/hooks for an initial authenticated read plus live updates and
reconnect reconciliation. Result data is usable as soon as the backend publishes
it. A transport interruption does not prove that an accepted command failed;
reuse the same operation ID and reconcile rather than issuing a fresh mutation.
Reusing an ID with different input is rejected.

Admission atomically claims effect ownership. Concurrent commands with the same
ID attach to the accepted operation instead of starting duplicate embedding or
native writes, even when their local timestamps differ. A replay observer cannot
replace the actual runner in the managed lifecycle registry.

Standalone services drain pending admissions as well as active work during
`dispose`. If authority is revoked mid-operation, its narrowly bound lifecycle
capability marks the accepted row `interrupted` without granting corpus reads or
returning data to the revoked caller. A restored session can reconcile that
terminal receipt rather than waiting on abandoned `running` state.

Custom distributed stores must implement `VectorVisualizationStore.claim`,
returning `{ snapshot, created, retire? }`. Only the winning `created: true`
claim may own effects. Its optional `retire` capability must be confined to that
accepted identity and terminal cleanup. Legacy stores without `claim` use
in-process serialization on one shared store object; independent wrappers or
multiple processes require an atomic database claim.

The bounded HTTP surface is `/api/vector-visualizations/search`, `/ingest`, `/map`,
`/:id` and `/:id/cancel`. Reads of nondefault indexes include `?index=knowledge`.
These routes currently accept web sessions, not API keys or native sessions.
All responses are private and noncacheable. No provider credentials are sent to
the browser, and no additional websocket is created.

## Search and score semantics

| Retrieval | Rerank | Actual execution |
| --- | --- | --- |
| `vector` | `false` | Embed and scoped dense retrieval. |
| `vector` | `true` | Dense retrieval followed by the configured model reranker. |
| `hybrid` | `false` | Independent dense and native full-text retrieval, then reciprocal-rank fusion. |
| `hybrid` | `true` | Fused candidates followed by model reranking. |

Hybrid mode requires the native index's explicit `lexical: true` setting. This is
full-corpus retrieval, not a keyword blend restricted to dense candidates. Both
legs receive the same required corpus filter. Dense diagnostics recompute the
configured metric from actual vectors; cosine, L2 distance, inner product,
fusion and reranker scores retain their own kind and better-score direction.

Native lexical and hybrid hits are hydrated from current records by their exact
IDs. Rechecking uses the configured text field (for example `body`) and current
scope metadata, so deleted, changed or re-scoped hits cannot inherit stale
authorization from the earlier native search.
The installed zvec engine does not allow scalar conditions on an FTS column.
When `lexical: true`, use the query's `text` for full-text matching and promoted
indexed metadata for scalar restrictions. Zero rejects scalar FTS-column filters
before native dispatch rather than returning an opaque engine parser failure.

## Ingestion acknowledgements and recovery

Ingestion splits accepted source text into bounded, section-aware chunks, keeps
source offsets and overlap, embeds through AIService, optionally enriches with a
trusted server callback, and writes through the bound native scope. Token counts
are marked approximate unless an actual model tokenizer is supplied.

Stable chunk IDs include corpus, index, document ID, source revision, chunk
index and a fingerprint of the source/chunking inputs. Repeating the same source
and split can safely upsert the same IDs. Reusing a source revision for changed
text or a changed splitting policy cannot overwrite different chunks. Different
source revisions coexist: this API is append-only versioning, not automatic
replacement or deletion of older corpus versions. Perform replacement through
an explicitly authorized application workflow with its own concurrency policy.

`storedAt` and completed chunk counts reflect acknowledged writes only. A partial
write or cancellation during a native write can leave an unknown outcome; the
snapshot says so rather than inventing success or rollback. Map diagnostics may
produce a safe warning without invalidating acknowledged business results.

Direct HTTP operations run in the application process. Their progress is durable,
but their execution is not a background job that automatically resumes after a
restart. Startup marks unfinished direct operations `interrupted`; it never
replays provider calls or assumes a native effect succeeded. Use the Torrent
activity adapter for durable ingestion, retaining the original document revision
and honoring the workflow's authority, retries, timeout and cancellation signal.

### Register Torrent activities explicitly

`registerVectorVisualizationActivities` registers version-pinned search and
ingestion activities in the existing Torrent registry. It does not create a
workflow, schedule work or authorize database-authored calls automatically.

```ts
import {
  registerVectorVisualizationActivities,
  type VectorVisualizationWorkflowOptions,
} from '@zero/framework/vector';
import type { WorkflowRegistry } from '@zero/framework/workflows';

export function installVectorActivities(
  registry: WorkflowRegistry,
  resolveService: VectorVisualizationWorkflowOptions['resolveService'],
) {
  return registerVectorVisualizationActivities(registry, { resolveService });
  // References: zero.vector.search@1 and zero.vector.ingest@1.
}
```

The application-owned resolver must return a service bound to the attempt's
trusted execution identity, corpus policy and current Guardian permissions. It
must not select tenant or provider authority from activity input. The resolver
also owns the lifecycle of a newly created service. The adapter independently
adds the original `StepContext.assertCurrentAuthority` fence and cancellation
signal to every provider/native/persistence effect and final result delivery.

Retries receive distinct operation IDs for each physical attempt while retaining
stable source revision and chunk identity. An incomplete or unknown outcome
cannot become a successful activity result. Successful output contains
`operationId` and the completed snapshot. `databaseCallable` defaults to `false`;
enabling it is an explicit application policy decision, not a visualization prop.

## Projection and engine capabilities

A bounded authorized sample fits a versioned PCA frame persisted per corpus and
index. Ordinary search, insertion and attachment reuse that frame. Added records
are projected into it without rotating existing points. A sample count is not a
claim about total corpus size.

An empty or identical-vector bootstrap sample has no usable variance. The service
may fit that initial degenerate frame once distinct stored vectors exist. After
a meaningful frame is established, changing its orientation requires an explicit
trusted refresh; ordinary queries do not refit it.

Search publishes the query's coordinates with its accepted map in one serialized
projection capture. Bootstrap or concurrent refresh cannot pair a new map with
query coordinates from an older frame.

Current zvec APIs do not expose native traversal paths. Neighbor links in these
maps are explicitly derived from the sampled vectors; visited/comparison metrics
appear only when an adapter supplies actual native trace capability. External
engines can implement the browser-safe `VectorVisualizationAdapter` contract
without pretending to use Zero's native index or authentication.

Neighbor construction is bounded independently of map size. All accepted points
remain visible, but high-dimensional/large maps compute links only within a
deterministic stable-ID subset whose squared size times dimensions stays below
100 million scalar terms. Other points have no links; no neighbors are guessed.
The ordinary 96-point sample fits that budget at every supported dimension.
