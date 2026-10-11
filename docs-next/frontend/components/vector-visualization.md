---
id: zero.components.vector-visualization
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: ingestion-search-visualization
maturity: supported
applies_to: ["2.6.0 unreleased working tree"]
modes: [browser, SSR, full, compact, inspector, external-engine, public-story]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-09"
  evidence_level: source-observed
---

# Ingestion and Search Visualization Components

[Components](./index.md) · [Backend configuration and execution](../../backend/vector/visualizations.md)

`VectorSearchVisualization` and `IngestionPipelineVisualization` render supplied
operation snapshots as a process rail, vector map and compact inspection panel.
They preserve the reference's functional readouts and flat composition while
using Zero theme tokens, controls, tooltips and dense-list rows. Rendering either
component does not start a search, call a model or write a vector.

## Attach to a real operation

```tsx
import { VectorSearchVisualization, useVectorOperation } from '@zero/framework';

export function SearchActivity({ operationId }: { operationId: string }) {
  const observation = useVectorOperation(operationId, { index: 'knowledge' });
  return <VectorSearchVisualization
    snapshot={observation.snapshot}
    presentation="compact"
    caption={observation.status === 'loading' ? 'Attaching to search…' : undefined}
  />;
}
```

This works for full-page inspectors, streamed chat tool activity and agent feeds.
The operation ID must come from the action that actually started the search.
Attaching observes it once; it does not call the action again. The hook masks
old data when Guardian retires the current scope and aborts stale reads after
selection changes. Detaching a viewer does not cancel someone else's operation.

`useVectorVisualization(id, options)` and its observer-oriented alias
`useVectorOperation` return observation status, snapshot, safe error text and
`attach`, `search`, `ingest`, `cancel` methods. Omit `options.adapter` for the
authenticated SDK or supply a stable external adapter. Managed hook methods
require current Guardian authority; external adapters own their authorization
and must retire data when it changes. Component visibility is not an access grant.

```tsx
import { IngestionPipelineVisualization, useVectorVisualization } from '@zero/framework';

export function DocumentIngestion({ id }: { id: string }) {
  const { snapshot } = useVectorVisualization(id, { index: 'knowledge' });
  return <IngestionPipelineVisualization snapshot={snapshot} />;
}
```

For imperative clients, `VectorVisualizationController` provides `attach`,
`getSnapshot`, `subscribe`, `search`, `ingest`, `cancel` and `dispose`. It keeps
accepted revisions monotonic and fences late callbacks. `dispose` detaches and
aborts reads; backend cancellation is a separate explicit command.
Synchronous adapter failures enter a safe error state and detach subscriptions.
An accepted command cannot repopulate content after its attachment has been
retired by an authoritative `null`, an error or an authority change.

## Controlled presentation

Both organisms accept `snapshot`, optional initial `map`, `presentation`,
`motionEnabled`, controlled `paused`/`onPausedChange`, `selectedRecordId`,
`onSelectRecord`, `selectedClusterId`, `onSelectCluster`, custom tooltip renderers,
`caption`, `className` and native section attributes.

| Presentation | Intended use |
| --- | --- |
| `full` | Map and detailed panel, side by side when the container has room. |
| `compact` | Inline chat/tool activity with a smaller, responsive composition. |
| `inspector` | The accessible diagnostic panel without the map. |

The ingestion organism also supports selected chunk inspection. All content
comes from accepted state: source/chunk spans, approximate token markers,
embedding preview, metadata, candidate order, final ranks and storage receipts.
Missing diagnostics remain unavailable rather than being replaced by random
vectors, fake documents or guessed engine metrics.

Pause affects visual motion only. It never blocks result delivery, pauses a
provider or acknowledges storage. Reduced motion disables nonessential effects
while preserving the same state and accessible result content.
New results, receipts and errors arriving during pause are shown immediately;
pause never freezes a new entrance at zero opacity.

The process rail is an ordered list of actual stages, not a time-driven tablist.
Indeterminate work remains waiting while its provider is pending. Optional
rerank/lexical stages appear only when the operation includes them.

## Inspect dots and cluster circles

Each record dot and cluster ring supports pointer and keyboard inspection through
Zero's existing Tooltip. Ring labels share the same tooltip and selection
callback. Provide controlled selection props to open your application's detail
panel, highlight a record or select a cluster. Without callbacks, the targets
remain focusable for inspection but do not claim to perform an action.

Default record tooltips show supplied title, source, cluster, dimensions and
actual candidate/result rank and score when available. Cluster tooltips count
only the supplied sampled records and identify projection/graph provenance;
they do not claim a corpus-wide total.

```tsx
import { useState } from 'react';
import { VectorSearchVisualization, VectorRecordTooltip } from '@zero/framework';
import type { VectorVisualizationSnapshot } from '@zero/framework/vector/visualization';

export function SearchInspector({ snapshot }: { snapshot: VectorVisualizationSnapshot }) {
  const [recordId, selectRecord] = useState<string>();
  const [clusterId, selectCluster] = useState<string>();
  return <VectorSearchVisualization
    snapshot={snapshot}
    selectedRecordId={recordId}
    onSelectRecord={selectRecord}
    selectedClusterId={clusterId}
    onSelectCluster={selectCluster}
    renderRecordTooltip={context => <div>
      <VectorRecordTooltip {...context} />
      <span>Record ID: {context.point.id}</span>
    </div>}
    renderClusterTooltip={({ cluster, points }) => <div>
      <strong>{cluster.label}</strong>
      <span>{points.length} records in this sample</span>
    </div>}
  />;
}
```

The same props work on `IngestionPipelineVisualization` and `VectorMap`.
`renderRecordTooltip(context)` receives `point`, `map`, optional `candidate` and
`result`, `selected` and `visited`. `renderClusterTooltip(context)` receives
`cluster`, `map`, its sampled `points` and `selected`. Return `undefined` to use
the default for a particular target, `null` to hide its tooltip, or React content
to customize it. `VectorRecordTooltip` and `VectorClusterTooltip` are exported
for composing the defaults. Application-owned extra details must already be
authorized for the current scope; renderers perform no implicit fetches.

The query marker and its label also support keyboard/pointer tooltips. Override
`renderQueryTooltip({ map, position, label, query })` with the same fallback/hide
rules. `VectorQueryTooltip` supplies the default body from actual query text,
retrieval mode, requested topK, rerank setting and available model/dimensions.
It does not pretend the query is an indexed record or offer record selection.

Tooltips complement the accessible result/chunk panels. Do not make essential
information or actions available only on hover.

## Compose smaller pieces

The focused `@zero/framework/components/vector-visualization` entry exports
`VectorMap`, `VectorResults`, `IngestionScene`, `VisualizationStageRail`,
`VectorEmbeddingPreview`, `VisualizationCounts`, `VisualizationMetadata`,
`VisualizationOperationStatus`, `VisualizationSourceTile`, `VisualizationRankDelta`,
`VisualizationLegend` and `ChunkReceipt`, alongside the two organisms. These
controlled pieces do not contain fetching or provider logic. Compose them inside
a `zero-viz` themed wrapper when building a custom arrangement. Interactive map
records have keyboard access and labeled inspection
actions; the result/chunk panels remain the accessible source of detailed data.

Connections identify their provenance. Derived sample neighbors are not native
HNSW visits. Native traversal and comparison counts require an adapter whose
capabilities explicitly admit them. Score tooltips name the metric and whether
higher or lower is better; relative score bars are not probabilities.

## Theme and motion tokens

Import Zero's normal global stylesheet. The component stylesheet is included
there and shipped by the package; source-copy installs it with the organism.
Use `import '@zero/framework/styles.css'` in package consumers. A source-copy
consumer must import its copied `vector-visualization.css` alongside the app's
existing Zero theme stylesheet; copying does not rewrite the app's style entry.
All color roles derive from the active semantic surface, foreground, border,
focus and chart-series tokens. Component variables use the `--zero-viz-*`
namespace, so applications can override the cascade without changing the
platform's default theme.

The scoped token family includes panel widths, typography, row/source geometry,
plane/model surfaces, grid/link treatments and motion. The reference's 700ms
rank movement, 70ms rank stagger, 60ms score stagger, 650ms acknowledged arrival
and compact readout transitions belong to presentation only. Backend completion
does not wait for those timings. The broader default-theme redesign remains a
separate task in the [design-token plan](../../_work/design-token-theme-evolution-plan.md).

## External engines and public stories

Import pure contracts and controllers from `@zero/framework/vector/visualization`;
this entry point does not open native indexes or import server persistence.
External adapters provide authorized snapshots through `get` and `subscribe`.
Optional `search`, `ingest`, `cancel` and `map` methods describe actual supported
capabilities. A `null` subscription update retires old sensitive content.
The managed adapter consumes bounded Sync metadata signals and reads only
attached operation IDs through HTTP. It does not download the full history of
past searches or ingestion documents. Imperative subscribers should call `get`
for their initial baseline, as shown in the backend guide.
Completed cards keep authority-retirement listeners but ignore unrelated feed
events, avoiding repeated reads of every historical card when new work arrives.
Reconnect still revalidates their current read permission.

For a landing page, pass explicit public fixtures to
`createVectorVisualizationStory(frames, { loop, speed })`. Frames contain an
`atMs` timestamp and a complete operation snapshot with a consistent ID. The
returned adapter exposes `play`, `pause`, `seek` and `dispose`; it makes no
provider requests, authenticated fetches or database writes. Frame revisions
are playback revisions, not durable server receipts. Label the surrounding
presentation as an example rather than live activity.

Do not embed private corpus data or credentials in public story fixtures.
Dispose playback when the view is removed, and respect reduced motion when
deciding whether a public page should autoplay.

## Verification and failure states

Test pending providers, empty indexes/results, malformed embeddings, failures,
cancellation, stale reads, rapid operation replacement and narrow containers.
Verify that rows retain identity when reranking and that final results remain
available while motion is paused. Ingestion may report an unknown write outcome;
show its message and reconcile the operation instead of implying rollback.
Nonfatal map warnings do not change acknowledged business outcomes.
