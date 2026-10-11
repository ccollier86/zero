/**
 * visualization-service-search.ts
 *
 * Executes actual scoped dense/lexical retrieval, rank fusion and optional AI
 * reranking. It publishes accepted stages and results, never invented native
 * traversal or animation-delayed tool completion.
 */
import type { StoredVectorRecord } from './vector-types';
import { VectorError } from './vector-error';
import { fuseVisualizationRanks, normalizeVisualizationVectorScore } from './visualization-model';
import type { VectorVisualizationCandidate } from './visualization-types';
import { awaitVisualizationExternal, validateEmbedding, type VisualizationOperationContext } from './visualization-service-context';
import { mapDiagnostic, operationMap, recordPresentation, type VectorVisualizationMapCoordinator } from './visualization-service-map';

/** Execute one accepted search; completion is entirely backend-driven. */
export async function runVisualizationSearch(context: VisualizationOperationContext,
  maps: VectorVisualizationMapCoordinator): Promise<void> {
  const query = context.snapshot.query!;
  const count = query.candidateCount ?? Math.max(query.topK, 20);
  await context.ensureCurrent();
  await context.stage('embed', 'waiting');
  await context.ensureCurrent();
  const embedded = await awaitVisualizationExternal(context.options.ai.embed({
    value: query.text, ...(context.options.embeddingModel ? { model: context.options.embeddingModel } : {}),
    abortSignal: context.signal, metadata: { operationId: context.snapshot.id, operation: 'visualization.search' },
  }), context.signal);
  const vector = validateEmbedding(embedded.embedding, context.options.dimensions);
  await context.update(snapshot => {
    snapshot.query = { ...snapshot.query!, dimensions: vector.length, embeddingPreview: vector.slice(0, 16),
      ...(context.options.embeddingModel ? { model: context.options.embeddingModel } : {}) };
  });
  await context.stage('embed', 'completed', 1, 1);
  await context.stage('retrieve', 'waiting');
  if (query.retrieval === 'hybrid') await context.stage('lexical', 'waiting');
  await context.ensureCurrent();
  const [dense, lexical] = await awaitVisualizationExternal(Promise.all([
    context.options.vectors.query({ vector, retrieval: 'vector', topK: count, includeVector: true }),
    query.retrieval === 'hybrid'
      ? context.options.vectors.query({ text: query.text, retrieval: 'lexical', topK: count, includeVector: true })
      : Promise.resolve([] as StoredVectorRecord[]),
  ]), context.signal);
  validateRecords(dense, count, context.options.dimensions);
  validateRecords(lexical, count, context.options.dimensions);
  await context.stage('retrieve', 'completed', dense.length, dense.length);
  if (query.retrieval === 'hybrid') await context.stage('lexical', 'completed', lexical.length, lexical.length);
  const rows = new Map([...dense, ...lexical].map(record => [record.id, record]));
  const ranks = query.retrieval === 'hybrid'
    ? fuseVisualizationRanks(dense.map(row => row.id), lexical.map(row => row.id), { limit: count })
    : dense.map((row, index) => ({ id: row.id, rank: index + 1,
      score: normalizeVisualizationVectorScore(context.options.metric ?? 'cosine', row.vector!, vector) }));
  if (query.retrieval === 'hybrid') await context.stage('fusion', 'completed', ranks.length, ranks.length);
  const candidates: VectorVisualizationCandidate[] = ranks.map(row => {
    const record = rows.get(row.id)!;
    const denseScore = normalizeVisualizationVectorScore(context.options.metric ?? 'cosine', record.vector!, vector);
    return { id: row.id, ...recordPresentation(record, context.options),
      ...(record.text && context.options.metadataFields?.includes('text') ? { text: record.text.slice(0, 256) } : {}), foundRank: row.rank,
      rank: row.rank, returned: false, score: row.score,
      scores: query.retrieval === 'hybrid' ? [denseScore, row.score] : [denseScore] };
  });
  await context.ensureCurrent();
  const projected = await mapDiagnostic(context, maps.acceptQuery(ranks.map(row => rows.get(row.id)!), vector,
    context.options.assertCurrentAuthority));
  await context.update(snapshot => {
    snapshot.candidates = candidates;
    if (projected) {
      snapshot.map = operationMap(projected.map, candidates.map(row => row.id));
      snapshot.query = { ...snapshot.query!, position: projected.position };
    }
  });

  let final = candidates.slice(0, query.topK);
  if (query.rerank && candidates.length) {
    await context.stage('rerank', 'waiting');
    await context.ensureCurrent();
    const documents = candidates.map(candidate => rows.get(candidate.id)?.text || candidate.title);
    if (documents.some(text => new TextEncoder().encode(text).byteLength > 65_536)) {
      throw new VectorError('VECTOR_BACKPRESSURE', 'A rerank document exceeds the bounded visualization input.');
    }
    const reranked = await awaitVisualizationExternal(context.options.ai.rerank({
      query: query.text, documents, topN: Math.min(query.topK, documents.length),
      ...(context.options.rerankingModel ? { model: context.options.rerankingModel } : {}),
      abortSignal: context.signal, metadata: { operationId: context.snapshot.id, operation: 'visualization.rerank' },
    }), context.signal);
    const seen = new Set<number>();
    if (!Array.isArray(reranked.ranking) || reranked.ranking.length > Math.min(query.topK, documents.length)) {
      throw new VectorError('VECTOR_OPERATION_FAILED', 'Reranker returned invalid ranked identities.');
    }
    final = reranked.ranking.map((entry, index) => {
      if (!Number.isSafeInteger(entry.originalIndex) || entry.originalIndex < 0 || entry.originalIndex >= candidates.length
        || seen.has(entry.originalIndex) || !Number.isFinite(entry.score)) {
        throw new VectorError('VECTOR_OPERATION_FAILED', 'Reranker returned invalid ranked identities.');
      }
      seen.add(entry.originalIndex);
      const candidate = candidates[entry.originalIndex]!;
      const score = { value: entry.score, kind: 'rerank' as const, direction: 'higher' as const };
      return { ...candidate, rank: index + 1, score, scores: [...candidate.scores ?? [], score] };
    });
    await context.stage('rerank', 'completed', final.length, final.length);
  } else if (query.rerank) {
    await context.stage('rerank', 'skipped', 0, 0);
  }
  const returned = new Map(final.map((row, index) => [row.id, { ...row, rank: index + 1, returned: true }]));
  await context.update(snapshot => {
    snapshot.candidates = candidates.map(candidate => returned.get(candidate.id) ?? candidate);
    snapshot.results = [...returned.values()];
    snapshot.status = 'completed';
  });
}

function validateRecords(records: readonly StoredVectorRecord[], maximum: number, dimensions: number): void {
  if (!Array.isArray(records) || records.length > maximum) throw new VectorError('VECTOR_OPERATION_FAILED', 'Retrieval returned an invalid bounded candidate list.');
  const ids = new Set<string>();
  for (const row of records) {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 1_024 || ids.has(row.id)
      || typeof row.metadata !== 'object' || row.metadata === null || !row.vector
      || (row.text !== undefined && typeof row.text !== 'string')) {
      throw new VectorError('VECTOR_OPERATION_FAILED', 'Retrieval returned invalid record identities.');
    }
    ids.add(row.id); validateEmbedding(row.vector, dimensions);
  }
}
