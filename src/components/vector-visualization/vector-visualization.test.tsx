/** Controlled SSR/geometry truth contracts; never connects to an app, provider, service or database. */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { VectorSearchVisualization, IngestionPipelineVisualization, VectorMap } from './index';
import { projectVectorPosition, vectorMapDescription, vectorMapEdges, vectorSeries } from './visualization-geometry';
import { ingestionDocumentLines } from './ingestion-scene';
import { VectorEmbeddingPreview, VisualizationStageRail } from './visualization-parts';
import { VectorClusterTooltip, VectorRecordTooltip, VectorQueryTooltip,
  type VectorClusterTooltipContext, type VectorRecordTooltipContext, type VectorQueryTooltipContext } from './vector-map-inspection';
import { syntheticIngestion, syntheticMap, syntheticSearch } from './vector-visualization.test-data';

test('full search SSR keeps readable query/dimensions/ranked list and truthful score provenance beside the real map', () => {
  const html = renderToString(<VectorSearchVisualization snapshot={syntheticSearch} />);
  expect(html).toContain('How do I rotate a leaked API key?'); expect(html).toContain('384 dims');
  expect(html).toContain('data-slot="vector-embedding-preview"'); expect(html).toContain('Ranked records');
  expect(html).toContain('cosine score 0.91, higher is better'); expect(html).toContain('data-record-id="record-1"');
  expect(html).toContain('derived neighbor links'); expect(html).toContain('data-trace="none"');
  expect(html).not.toContain('true neighbours'); expect(html).not.toContain('Comparisons'); expect(html).not.toContain('Visited');
  expect(html).not.toContain('<script>');
});

test('missing snapshot is useful, SSR safe and does not invent counts, paths or query vectors', () => {
  const html = renderToString(<VectorSearchVisualization />);
  expect(html).toContain('Ready when you are.'); expect(html).toContain('No candidates have been returned');
  expect(html).toContain('Embedding not available yet'); expect(html).not.toContain('vector-query-marker');
  expect(html).not.toContain('384'); expect(html).not.toContain('vector-neighbor-edge');
});

test('native trace requires engine capability; an explicit illustrative trace remains visibly labeled', () => {
  const trace = { provenance: 'native' as const, visitedIds: ['record-1'], comparisons: 3, edges: [{ from: 'record-1', to: 'record-4' }] };
  const rejected = renderToString(<VectorMap map={syntheticMap} trace={trace} />);
  expect(rejected).not.toContain('vector-trace-edge'); expect(rejected).toContain('data-trace="none"');
  const illustrative = renderToString(<VectorMap map={syntheticMap} trace={{ ...trace, provenance: 'illustrative' }} />);
  expect(illustrative).toContain('Illustrative sample traversal · not native index telemetry'); expect(illustrative).toContain('vector-trace-edge');
  const accepted = renderToString(<VectorMap map={{ ...syntheticMap, capabilities: { ...syntheticMap.capabilities, nativeTraversal: true } }} trace={trace} />);
  expect(accepted).toContain('data-trace="native"'); expect(accepted).toContain('data-visited="true"');
});

test('ingestion overlap/ranges remain supplied data and unacknowledged completion never claims stored', () => {
  const html = renderToString(<IngestionPipelineVisualization snapshot={syntheticIngestion} />);
  expect(html).toContain('Webhook signing guide'); expect(html).toContain('data-slot="ingestion-scene"');
  expect(html).toContain('chars 85–180'); expect(html).toContain('23 characters with preceding chunk'); expect(html).toContain('<mark');
  expect(html).toContain('Approximately 67'); expect(html).toContain('Embedding model');
  expect(html).not.toContain('Storage acknowledged'); expect(html).not.toContain('zero-viz__flight');
  expect(html).toContain('Accepted document chunks');
});

test('an acknowledged storage result renders its receipt, while unknown outcomes remain explicit', () => {
  const ingestion = structuredClone(syntheticIngestion);
  ingestion.ingestion!.chunks = ingestion.ingestion!.chunks.map(chunk => ({ ...chunk, storedAt: '2026-10-08T00:01:00Z' }));
  const html = renderToString(<IngestionPipelineVisualization snapshot={ingestion} />);
  expect(html).toContain('Storage acknowledged');
  const failed = renderToString(<VectorSearchVisualization snapshot={{ ...syntheticSearch, status: 'failed', error: { code: 'TEST', message: 'Safe failure', outcomeUnknown: true } }} />);
  expect(failed).toContain('role="alert"'); expect(failed).toContain('write outcome is unknown');
});

test('nonfatal diagnostic warnings do not restyle an acknowledged operation as a failure', () => {
  const html = renderToString(<VectorSearchVisualization snapshot={{ ...syntheticSearch,
    warnings: [{ code: 'MAP_UNAVAILABLE', message: 'Map diagnostics temporarily unavailable.' }] }} />);
  expect(html).toContain('Map diagnostics temporarily unavailable.'); expect(html).toContain('data-status="completed"');
  expect(html).toContain('aria-label="Visualization diagnostics" role="status"'); expect(html).not.toContain('role="alert"');
});

test('unknown progress stays indeterminate and completed/skipped stages do not gain fake current state', () => {
  const html = renderToString(<VisualizationStageRail paused={false} stages={[{ id: 'embed', label: 'Embed', status: 'waiting' },
    { id: 'retrieve', label: 'Retrieve', status: 'completed' }, { id: 'rerank', label: 'Rerank', status: 'skipped' }]} />);
  expect(html).toContain('data-indeterminate="true"'); expect(html.match(/aria-current="step"/gu)).toHaveLength(1);
  expect(html).toContain('transform:scaleX(1)'); expect(html).not.toContain('role="tablist"');
});

test('inspector presentation removes the scene but retains accessible results; all source text is escaped', () => {
  const html = renderToString(<VectorSearchVisualization presentation="inspector" snapshot={{ ...syntheticSearch,
    query: { ...syntheticSearch.query!, text: '<script>fake()</script>' } }} />);
  expect(html).not.toContain('data-slot="vector-map"'); expect(html).toContain('&lt;script&gt;fake()&lt;/script&gt;');
  expect(html).toContain('Search results'); expect(html).not.toContain('<script>');
});

test('finite embedding preview values alone produce bars without implying a full embedding', () => {
  const html = renderToString(<VectorEmbeddingPreview values={[.2, NaN, -.1, Infinity]} dimensions={768} />);
  expect(html.match(/data-sign=/gu)).toHaveLength(2); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  expect(html).toContain('… +766');
});

test('map geometry clamps invalid visual positions and only deduplicates supplied topology', () => {
  expect(projectVectorPosition({ x: NaN, y: 0 })).toBeNull(); expect(projectVectorPosition({ x: 0, y: 0 })).toEqual({ x: 320, y: 224.5 });
  expect(projectVectorPosition({ x: 4, y: -4 })).toEqual(projectVectorPosition({ x: 1, y: -1 }));
  expect(vectorMapEdges({ ...syntheticMap, capabilities: { ...syntheticMap.capabilities, graph: 'none' } })).toEqual([]);
  const edges = vectorMapEdges(syntheticMap); expect(edges.length).toBe(42);
  expect(vectorSeries('access')).toBe(vectorSeries('access')); expect(vectorMapDescription(syntheticMap)).not.toContain('fidelity');
});

test('document line wrapping preserves offsets used by chunk highlight diagnostics', () => {
  const text = '## Heading\nalpha beta gamma delta\nnext';
  for (const line of ingestionDocumentLines(text, 10)) expect(text.slice(line.start, line.end)).toBe(line.text);
  expect(ingestionDocumentLines(text, 10)[0]!.heading).toBe(true);
});

test('default record and cluster tooltip content describes actual sampled data and score provenance', () => {
  const point = syntheticMap.points.find(item => item.id === 'record-1')!, result = syntheticSearch.results![0]!;
  const record = renderToString(<VectorRecordTooltip point={point} map={syntheticMap} result={result} selected={false} visited={false} />).replaceAll('<!-- -->', '');
  expect(record).toContain(point.title); expect(record).toContain('Notion'); expect(record).toContain('384 dimensions');
  expect(record).toContain('Result rank 1'); expect(record).toContain('cosine 0.91'); expect(record).not.toContain('native search telemetry');
  const cluster = syntheticMap.clusters[0]!, points = syntheticMap.points.filter(item => item.clusterId === cluster.id);
  const grouped = renderToString(<VectorClusterTooltip cluster={cluster} map={syntheticMap} points={points} selected={false} />);
  expect(grouped).toContain('7'); expect(grouped).toContain('sampled'); expect(grouped).toContain('derived neighbor links');
});

test('both organisms forward controlled inspection renderers and cluster selection without leaking props to native elements', () => {
  for (const kind of ['search', 'ingestion'] as const) {
    const records: VectorRecordTooltipContext[] = [], clusters: VectorClusterTooltipContext[] = [];
    const props = { selectedRecordId: 'record-1', selectedClusterId: 'billing', onSelectCluster: () => {},
      renderRecordTooltip: (context: VectorRecordTooltipContext) => { records.push(context); return null; },
      renderClusterTooltip: (context: VectorClusterTooltipContext) => { clusters.push(context); return null; } };
    const html = renderToString(kind === 'search' ? <VectorSearchVisualization snapshot={syntheticSearch} {...props} />
      : <IngestionPipelineVisualization snapshot={syntheticIngestion} {...props} />);
    expect(records).toHaveLength(21); expect(clusters).toHaveLength(3);
    expect(records.find(context => context.point.id === 'record-1')).toMatchObject({ selected: true, visited: false });
    expect(clusters.find(context => context.cluster.id === 'billing')!.selected).toBe(true);
    expect(clusters[0]!.points).toHaveLength(7);
    expect(html).toContain('zero-viz__cluster-target'); expect(html).toContain('role="button" aria-label="Inspect Billing"');
    expect(html).not.toContain('renderRecordTooltip='); expect(html).not.toContain('renderClusterTooltip=');
    if (kind === 'search') expect(records.find(context => context.point.id === 'record-1')!.result).toBe(syntheticSearch.results![0]);
    else expect(records.every(context => context.result === undefined)).toBe(true);
  }
});

test('a single authorized sampled record still exposes its real cluster inspection target', () => {
  const context: VectorClusterTooltipContext[] = [];
  const html = renderToString(<VectorMap map={{ ...syntheticMap, points: syntheticMap.points.slice(0, 1) }}
    renderClusterTooltip={value => { context.push(value); return null; }} />);
  expect(context).toHaveLength(1); expect(context[0]!.cluster.id).toBe('billing'); expect(context[0]!.points).toHaveLength(1);
  expect(html).toContain('class="zero-viz__cluster-target"'); expect(html).toContain('role="img" aria-label="Cluster Billing"');
});

test('completed result counts describe actual returned records rather than promising an unfilled requested topK', () => {
  const result = syntheticSearch.results![0]!;
  const html = renderToString(<VectorSearchVisualization snapshot={{ ...syntheticSearch, candidates: [result], results: [result] }} />);
  expect(html).toContain('top 1 of 1'); expect(html).toContain('Requested top 3; 1 returned of 1 candidates');
  expect(html).not.toContain('top 3 of 1');
});

test('query marker inspection uses supplied diagnostics and forwards a pure renderer without inventing an ingestion query', () => {
  const contexts: VectorQueryTooltipContext[] = [];
  const html = renderToString(<VectorSearchVisualization snapshot={syntheticSearch}
    renderQueryTooltip={value => { contexts.push(value); return null; }} />);
  expect(contexts).toHaveLength(1); expect(contexts[0]!.query).toBe(syntheticSearch.query);
  expect(contexts[0]!.map).toBe(syntheticSearch.map); expect(contexts[0]!.position).toBe(syntheticSearch.query!.position!);
  expect(html).toContain('data-slot="vector-query-inspection"'); expect(html).toContain('role="img" aria-label="Query marker"');
  expect(html).not.toContain('renderQueryTooltip=');
  const defaults = renderToString(<VectorQueryTooltip {...contexts[0]!} />).replaceAll('<!-- -->', '');
  expect(defaults).toContain(syntheticSearch.query!.text); expect(defaults).toContain('Vector retrieval');
  expect(defaults).toContain('requested top 3'); expect(defaults).toContain('384 dimensions');
  expect(defaults).toContain('Reranking disabled');
  const missing = renderToString(<VectorQueryTooltip label="Supplied marker" position={{ x: 0, y: 0 }} />);
  expect(missing).toContain('Supplied marker'); expect(missing).not.toContain('dimensions'); expect(missing).not.toContain('retrieval');
  contexts.length = 0;
  const ingestion = renderToString(<IngestionPipelineVisualization snapshot={syntheticIngestion}
    renderQueryTooltip={value => { contexts.push(value); return null; }} />);
  expect(contexts).toHaveLength(0); expect(ingestion).not.toContain('vector-query-inspection');
});
