/** Deterministic synthetic DTOs for isolated component tests only; no real documents/providers/indexes. */
import type { VectorVisualizationCandidate, VectorVisualizationMap, VectorVisualizationSnapshot } from '../../vector/visualization-types';

export const syntheticVectorPreview = [.122, -.093, .064, .221, -.153, .047, .108, -.068, .091, -.034, .141, .011, -.183, .061, .081, -.112];
export const syntheticMap: VectorVisualizationMap = {
  revision: 1, projectionId: 'synthetic-projection-v1', projectionKind: 'provided', dimensions: 384, model: 'Synthetic embedding fixture', totalRecords: 42,
  capabilities: { nativeTraversal: false, graph: 'derived-neighbors', liveUpdates: false },
  clusters: [{ id: 'billing', label: 'Billing' }, { id: 'access', label: 'Access' }, { id: 'deploys', label: 'Deploys' }],
  points: Array.from({ length: 21 }, (_, i) => {
    const cluster = i % 3, offset = Math.floor(i / 3);
    const center = [{ x: -.52, y: -.45 }, { x: .44, y: -.3 }, { x: .05, y: .52 }][cluster]!;
    return { id: `record-${i}`, title: ['Invoices and payment', 'Rotate access keys', 'Deploy release safely'][cluster]! + ` ${offset + 1}`,
      position: { x: center.x + Math.cos(offset * 1.37) * .14, y: center.y + Math.sin(offset * 1.37) * .14 },
      clusterId: ['billing', 'access', 'deploys'][cluster]!, source: { id: `source-${cluster}`, label: ['Help center', 'Notion', 'GitHub'][cluster]! },
      neighborIds: [`record-${(i + 3) % 21}`, `record-${(i + 6) % 21}`], kind: 'stored' as const };
  }),
};
export const syntheticCandidates: VectorVisualizationCandidate[] = [1, 4, 7, 10, 13].map((id, i) => ({
  id: `record-${id}`, title: ['Rotate leaked API keys', 'Organization access policy', 'Create a scoped token', 'Audit API activity', 'Invite your team'][i]!,
  source: { id: 'notion', label: 'Notion', abbreviation: 'N' }, clusterId: 'access', foundRank: i + 1, rank: i + 1,
  score: { value: .91 - i * .12, kind: 'cosine', direction: 'higher' }, returned: i < 3,
}));
export const syntheticSearch: VectorVisualizationSnapshot = {
  id: 'synthetic-search', kind: 'search', index: 'synthetic-index', revision: 3, status: 'completed', createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z',
  stages: [{ id: 'embed', label: 'Embed', status: 'completed', completed: 1, total: 1 }, { id: 'query', label: 'Search', status: 'completed' },
    { id: 'retrieve', label: 'Retrieve', status: 'completed', completed: 5, total: 5 }, { id: 'rerank', label: 'Rerank', status: 'skipped' }],
  map: syntheticMap, query: { text: 'How do I rotate a leaked API key?', retrieval: 'vector', rerank: false, topK: 3, dimensions: 384,
    embeddingPreview: syntheticVectorPreview, position: { x: .55, y: -.15 } },
  candidates: syntheticCandidates, results: syntheticCandidates.slice(0, 3),
};
const source = '## Webhook signing\nEvery webhook carries a signature header. Compute an HMAC of the raw body and compare it before trusting the payload.\n\n## Rotating the secret\nAccept both signing secrets for a short overlap window, then retire the old secret.';
export const syntheticIngestion: VectorVisualizationSnapshot = {
  id: 'synthetic-ingestion', kind: 'ingestion', index: 'synthetic-index', revision: 2, status: 'waiting', createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z',
  stages: [{ id: 'accept', label: 'Ingest', status: 'completed', completed: 1, total: 1 }, { id: 'chunk', label: 'Chunk', status: 'completed', completed: 3, total: 3 },
    { id: 'embed', label: 'Embed', status: 'waiting', completed: 1, total: 3 }, { id: 'enrich', label: 'Enrich', status: 'pending' }, { id: 'index', label: 'Index', status: 'pending' }],
  map: syntheticMap, ingestion: { document: { id: 'synthetic-doc', title: 'Webhook signing guide', source: { id: 'notion', label: 'Notion' }, clusterId: 'access', text: source },
    chunks: [{ id: 'chunk-0', documentId: 'synthetic-doc', index: 0, text: source.slice(0, 108), section: 'Webhook signing', start: 0, end: 108,
      overlapChars: 0, tokenCount: 25, tokenCountApproximate: true, status: 'completed', stageId: 'enrich', embeddingPreview: syntheticVectorPreview, dimensions: 384 },
    { id: 'chunk-1', documentId: 'synthetic-doc', index: 1, text: source.slice(85, 180), section: 'Webhook signing', start: 85, end: 180,
      overlapChars: 23, tokenCount: 23, tokenCountApproximate: true, status: 'waiting', stageId: 'embed' },
    { id: 'chunk-2', documentId: 'synthetic-doc', index: 2, text: source.slice(160), section: 'Rotating the secret', start: 160, end: source.length,
      overlapChars: 20, tokenCount: 19, tokenCountApproximate: true, status: 'pending', stageId: 'embed' }],
    currentChunkId: 'chunk-1', completedChunks: 0, tokenCount: 67, tokenCountApproximate: true },
};
