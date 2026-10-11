/** Isolated DTO admission tests: malformed transport stops before either organism renders. No HTTP, provider or database work. */
import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { parseVectorVisualizationMap, parseVectorVisualizationSnapshot } from './vector-visualization-client';
import { VectorSearchVisualization, IngestionPipelineVisualization } from '../../components/vector-visualization';
import { syntheticSearch, syntheticIngestion, syntheticMap } from '../../components/vector-visualization/vector-visualization.test-data';

const candidate = syntheticSearch.candidates![0]!;
const point = syntheticMap.points[0]!;
const chunk = syntheticIngestion.ingestion!.chunks[0]!;
const withQuery = (query: unknown) => ({ ...syntheticSearch, query });
const withCandidate = (change: Record<string, unknown>) => ({ ...syntheticSearch, candidates: [{ ...candidate, ...change }] });
const withPoint = (change: Record<string, unknown>) => ({ ...syntheticMap, points: [{ ...point, ...change }] });
const withChunk = (change: Record<string, unknown>) => ({ ...syntheticIngestion,
  ingestion: { ...syntheticIngestion.ingestion, chunks: [{ ...chunk, ...change }] } });
const withIngestion = (change: Record<string, unknown>) => ({ ...syntheticIngestion, ingestion: { ...syntheticIngestion.ingestion, ...change } });
const withTrace = (change: Record<string, unknown>) => ({ ...syntheticSearch,
  trace: { provenance: 'native', visitedIds: ['record-1'], edges: [{ from: 'record-1', to: 'record-4' }], comparisons: 3, ...change } });

describe('vector visualization nested transport admission', () => {
  it('accepts canonical full search/ingestion/map DTOs without copying, coercing or dropping fields', () => {
    const search = { ...syntheticSearch,
      query: { ...syntheticSearch.query!, model: 'Configured embedding alias', candidateCount: 20 },
      candidates: syntheticSearch.candidates!.map(item => ({ ...item, scores: [item.score], text: '' })),
      trace: { provenance: 'native' as const, visitedIds: ['record-1'], edges: [{ from: 'record-1', to: 'record-4' }], comparisons: 4 },
      warnings: [{ code: 'MAP_UNAVAILABLE', message: 'Diagnostic temporarily unavailable.', retryable: true, outcomeUnknown: false }],
    };
    const ingestion = { ...syntheticIngestion, ingestion: { ...syntheticIngestion.ingestion!, sourceRevision: 'revision:1', currentChunkId: chunk.id,
      chunks: [{ ...chunk, attempt: 0, storedAt: '2026-10-08T00:00:00Z', metadata: { empty: '', string: 'A', number: -.5, boolean: false, nullable: null } }] },
      error: { code: 'WRITE_INTERRUPTED', message: 'Check the write outcome.', retryable: false, outcomeUnknown: true },
    };
    expect(parseVectorVisualizationSnapshot(search)).toBe(search);
    expect(parseVectorVisualizationSnapshot(ingestion)).toBe(ingestion);
    expect(parseVectorVisualizationMap(syntheticMap)).toBe(syntheticMap);
    expect(renderToString(createElement(VectorSearchVisualization, { snapshot: search }))).toContain('How do I rotate a leaked API key?');
    expect(renderToString(createElement(IngestionPipelineVisualization, { snapshot: ingestion }))).toContain('Storage acknowledged');
    expect(parseVectorVisualizationSnapshot(null)).toBeNull();
  });

  it('keeps optional/indeterminate state and labeled custom engine stages valid', () => {
    const minimal = { id: 'operation', index: 'knowledge', kind: 'search', status: 'pending', revision: 1,
      createdAt: '2026-10-08', updatedAt: '2026-10-08', stages: [] };
    for (const status of ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted'] as const) {
      expect(parseVectorVisualizationSnapshot({ ...minimal, status, stages: [{ id: 'external-engine', label: 'Native engine', status, completed: 0, total: 0 }] })?.status).toBe(status);
    }
    expect(parseVectorVisualizationMap({ ...syntheticMap, points: [], clusters: [], totalRecords: 0,
      capabilities: { nativeTraversal: false, graph: 'none', liveUpdates: false } }).points).toEqual([]);
  });

  const malformedSnapshots: Array<[string, unknown]> = [
    ['query object', withQuery('not an object')],
    ['query text', withQuery({ ...syntheticSearch.query, text: {} })],
    ['query retrieval', withQuery({ ...syntheticSearch.query, retrieval: 'unknown' })],
    ['query rerank', withQuery({ ...syntheticSearch.query, rerank: 1 })],
    ['query topK', withQuery({ ...syntheticSearch.query, topK: 0 })],
    ['query candidateCount', withQuery({ ...syntheticSearch.query, candidateCount: 1.5 })],
    ['query dimensions', withQuery({ ...syntheticSearch.query, dimensions: 8193 })],
    ['query model', withQuery({ ...syntheticSearch.query, model: {} })],
    ['query embeddingPreview string', withQuery({ ...syntheticSearch.query, embeddingPreview: 'bad' })],
    ['query embeddingPreview nonnumeric', withQuery({ ...syntheticSearch.query, embeddingPreview: [0, '1'] })],
    ['query embeddingPreview nonfinite', withQuery({ ...syntheticSearch.query, embeddingPreview: [0, Infinity] })],
    ['query position', withQuery({ ...syntheticSearch.query, position: { x: '0', y: 1 } })],
    ['candidate null', { ...syntheticSearch, candidates: [null] }],
    ['candidate source', withCandidate({ source: { label: {} } })],
    ['candidate cluster', withCandidate({ clusterId: 1 })],
    ['candidate excerpt', withCandidate({ text: {} })],
    ['candidate rank', withCandidate({ rank: Number.MAX_SAFE_INTEGER + 1 })],
    ['candidate foundRank', withCandidate({ foundRank: 0 })],
    ['candidate returned', withCandidate({ returned: 'yes' })],
    ['candidate score kind', withCandidate({ score: { value: .7, kind: 'probability', direction: 'higher' } })],
    ['candidate score direction', withCandidate({ score: { value: .7, kind: 'cosine', direction: 'up' } })],
    ['candidate scores', withCandidate({ scores: [null] })],
    ['duplicate candidate identities', { ...syntheticSearch, candidates: [candidate, candidate] }],
    ['result score', { ...syntheticSearch, results: [{ ...candidate, score: null }] }],
    ['trace provenance', withTrace({ provenance: 'guessed' })],
    ['trace visitedIds', withTrace({ visitedIds: 'record-1' })],
    ['trace visited identity', withTrace({ visitedIds: [null] })],
    ['trace edge', withTrace({ edges: [null] })],
    ['trace edge target', withTrace({ edges: [{ from: 'record-1', to: {} }] })],
    ['trace comparisons', withTrace({ comparisons: -1 })],
    ['warning null', { ...syntheticSearch, warnings: [null] }],
    ['warning code', { ...syntheticSearch, warnings: [{ code: {}, message: 'Safe message' }] }],
    ['warning message', { ...syntheticSearch, warnings: [{ code: 'CODE', message: {} }] }],
    ['warning retryable', { ...syntheticSearch, warnings: [{ code: 'CODE', message: 'Safe message', retryable: 'yes' }] }],
    ['error outcomeUnknown', { ...syntheticSearch, error: { code: 'CODE', message: 'Safe message', outcomeUnknown: 1 } }],
    ['stage progress', { ...syntheticSearch, stages: [{ ...syntheticSearch.stages[0], completed: -1 }] }],
    ['stage timestamp', { ...syntheticSearch, stages: [{ ...syntheticSearch.stages[0], startedAt: {} }] }],
    ['duplicate stage identities', { ...syntheticSearch, stages: [syntheticSearch.stages[0], syntheticSearch.stages[0]] }],
    ['ingestion document', withIngestion({ document: null })],
    ['ingestion document text', withIngestion({ document: { ...syntheticIngestion.ingestion!.document, text: 1 } })],
    ['ingestion source', withIngestion({ document: { ...syntheticIngestion.ingestion!.document, source: { label: null } } })],
    ['ingestion completedChunks', withIngestion({ completedChunks: -1 })],
    ['ingestion tokenCount', withIngestion({ tokenCount: 1.5 })],
    ['ingestion approximate marker', withIngestion({ tokenCountApproximate: 'true' })],
    ['ingestion currentChunkId', withIngestion({ currentChunkId: 1 })],
    ['ingestion revision', withIngestion({ sourceRevision: {} })],
    ['ingestion chunk null', withIngestion({ chunks: [null] })],
    ['chunk identity', withChunk({ id: {} })],
    ['chunk document identity', withChunk({ documentId: {} })],
    ['chunk index', withChunk({ index: -1 })],
    ['chunk text', withChunk({ text: 1 })],
    ['chunk section', withChunk({ section: {} })],
    ['chunk span', withChunk({ start: 10, end: 9 })],
    ['chunk overlap', withChunk({ overlapChars: -1 })],
    ['chunk tokenCount', withChunk({ tokenCount: '25' })],
    ['chunk approximate marker', withChunk({ tokenCountApproximate: null })],
    ['chunk stage', withChunk({ stageId: 'not-a-stage' })],
    ['chunk attempt', withChunk({ attempt: -.5 })],
    ['chunk dimensions', withChunk({ dimensions: 0 })],
    ['chunk preview', withChunk({ embeddingPreview: 'bad' })],
    ['chunk metadata array', withChunk({ metadata: [] })],
    ['chunk metadata nested value', withChunk({ metadata: { hidden: { arbitrary: 'data' } } })],
    ['chunk storage receipt', withChunk({ storedAt: 1 })],
    ['snapshot nested invalid map', { ...syntheticSearch, map: withPoint({ title: {} }) }],
  ];
  it.each(malformedSnapshots)('rejects malformed %s before publication', (_label, value) => {
    expect(() => parseVectorVisualizationSnapshot(value)).toThrow();
  });

  const malformedMaps: Array<[string, unknown]> = [
    ['projection kind', { ...syntheticMap, projectionKind: 'guessed' }],
    ['dimensions', { ...syntheticMap, dimensions: .5 }],
    ['totalRecords', { ...syntheticMap, totalRecords: -1 }],
    ['model', { ...syntheticMap, model: {} }],
    ['nativeTraversal capability', { ...syntheticMap, capabilities: { ...syntheticMap.capabilities, nativeTraversal: 'true' } }],
    ['graph capability', { ...syntheticMap, capabilities: { ...syntheticMap.capabilities, graph: 'hnsw' } }],
    ['liveUpdates capability', { ...syntheticMap, capabilities: { ...syntheticMap.capabilities, liveUpdates: 1 } }],
    ['cluster null', { ...syntheticMap, clusters: [null] }],
    ['cluster label', { ...syntheticMap, clusters: [{ id: 'cluster', label: {} }] }],
    ['point null', { ...syntheticMap, points: [null] }],
    ['point title', withPoint({ title: {} })],
    ['point coordinates', withPoint({ position: { x: Infinity, y: 1 } })],
    ['point cluster', withPoint({ clusterId: {} })],
    ['point source', withPoint({ source: { label: 'Source', abbreviation: 1 } })],
    ['point neighbors string', withPoint({ neighborIds: 'record-4' })],
    ['point neighbor null', withPoint({ neighborIds: [null] })],
    ['point kind', withPoint({ kind: 'guessed' })],
    ['duplicate point identities', { ...syntheticMap, points: [point, point] }],
    ['duplicate cluster identities', { ...syntheticMap, clusters: [syntheticMap.clusters[0], syntheticMap.clusters[0]] }],
  ];
  it.each(malformedMaps)('rejects malformed map %s', (_label, value) => {
    expect(() => parseVectorVisualizationMap(value)).toThrow();
    expect(() => parseVectorVisualizationSnapshot({ ...syntheticSearch, map: value })).toThrow();
  });

  it('rejects the original parser-to-SSR crashes before either organism can be invoked', () => {
    for (const [component, value] of [
      [VectorSearchVisualization, withQuery({ ...syntheticSearch.query, embeddingPreview: 'bad' })],
      [IngestionPipelineVisualization, withIngestion({ chunks: [null] })],
      [VectorSearchVisualization, { ...syntheticSearch, warnings: [null] }],
    ] as const) {
      let admitted = false;
      expect(() => {
        const snapshot = parseVectorVisualizationSnapshot(value);
        admitted = true;
        renderToString(createElement(component, { snapshot }));
      }).toThrow('Invalid vector visualization snapshot.');
      expect(admitted).toBe(false);
    }
  });

  it('rejects sparse and oversized nested arrays instead of skipping holes or rendering unbounded content', () => {
    expect(() => parseVectorVisualizationSnapshot({ ...syntheticSearch, candidates: Array(1) })).toThrow();
    expect(() => parseVectorVisualizationSnapshot(withQuery({ ...syntheticSearch.query, embeddingPreview: Array(1) }))).toThrow();
    expect(() => parseVectorVisualizationSnapshot(withQuery({ ...syntheticSearch.query, embeddingPreview: Array(8193).fill(0) }))).toThrow();
    expect(() => parseVectorVisualizationSnapshot({ ...syntheticSearch, warnings: Array(33).fill({ code: 'CODE', message: 'Safe message' }) })).toThrow();
    expect(() => parseVectorVisualizationMap(withPoint({ neighborIds: Array(513).fill('record-4') }))).toThrow();
    expect(() => parseVectorVisualizationSnapshot(withChunk({ metadata: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, index])) }))).toThrow();
  });

  it('rejects accessors anywhere, including hidden nested data and symbol descriptors, without invoking them', () => {
    let reads = 0;
    const accessor = { get text() { reads++; return 'Private source'; } };
    const hidden = { ...syntheticSearch };
    Object.defineProperty(hidden, 'query', { enumerable: false, value: accessor });
    const symbolic = { ...syntheticSearch };
    Object.defineProperty(symbolic, Symbol('hidden'), { get() { reads++; return 'Private source'; } });
    const array = [0];
    Object.defineProperty(array, '0', { get() { reads++; return 1; } });
    for (const value of [hidden, symbolic, withQuery(accessor), withQuery({ ...syntheticSearch.query, embeddingPreview: array })]) {
      expect(() => parseVectorVisualizationSnapshot(value)).toThrow();
    }
    expect(reads).toBe(0);
    const inherited = Object.create({ get id() { reads++; return 'record-1'; } });
    expect(() => parseVectorVisualizationMap({ ...syntheticMap, points: [inherited] })).toThrow();
    const changedArray = [point]; Object.setPrototypeOf(changedArray, { get length() { reads++; return 1; } });
    expect(() => parseVectorVisualizationMap({ ...syntheticMap, points: changedArray })).toThrow();
    expect(reads).toBe(0);
  });

  it('reports bounded safe validation errors rather than incorporating rejected private payloads', () => {
    expect(() => parseVectorVisualizationSnapshot(withQuery({ ...syntheticSearch.query, embeddingPreview: 'private rejected provider content' }))).toThrow('Invalid vector visualization snapshot.');
    try { parseVectorVisualizationSnapshot(withQuery({ ...syntheticSearch.query, embeddingPreview: 'private rejected provider content' })); }
    catch (error) { expect(String(error)).not.toContain('private rejected'); }
  });
});
