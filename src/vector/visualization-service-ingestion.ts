/**
 * visualization-service-ingestion.ts
 *
 * Splits real source text, obtains validated AI embeddings and records actual
 * optional enrichment and native upsert acknowledgements. Source revisions are
 * append-only; replacement/deletion belongs to an app's scoped workflow.
 */
import { createHash } from 'node:crypto';
import { VectorError } from './vector-error';
import type { StoredVectorRecord, VectorRecord, VectorWriteResult } from './vector-types';
import { splitVisualizationDocument } from './visualization-chunker';
import type { VectorVisualizationChunk } from './visualization-types';
import { awaitVisualizationExternal, copy, time, validateEmbedding, type VisualizationOperationContext } from './visualization-service-context';
import { mapDiagnostic, operationMap, type VectorVisualizationMapCoordinator } from './visualization-service-map';

const BATCH_SIZE = 16;

/** Stable append-only IDs are independent of animation, retries and operation attempts. */
export function visualizationChunkId(scope: string, index: string, documentId: string,
  sourceRevision: string, chunkIndex: number, contentFingerprint: string): string {
  // Native zvec IDs are capped at 64 characters. A domain-separated full hash
  // fits that boundary without truncating identity entropy or source content.
  return createHash('sha256').update(JSON.stringify(['zero.visualization.chunk-v1',
    scope, index, documentId, sourceRevision, chunkIndex, contentFingerprint])).digest('hex');
}

/** Execute one accepted ingestion using only real provider and native acknowledgements. */
export async function runVisualizationIngestion(context: VisualizationOperationContext,
  maps: VectorVisualizationMapCoordinator): Promise<void> {
  const ingestion = context.snapshot.ingestion!;
  const document = ingestion.document;
  const revision = ingestion.sourceRevision!;
  await context.stage('chunk', 'running');
  const split = splitVisualizationDocument(document.text!, { maxChars: 1_000, maxTokens: 256,
    overlapChars: 120, ...context.options.chunk, maxChunks: Math.min(128, context.options.chunk?.maxChunks ?? 128) });
  const contentFingerprint = createHash('sha256').update(JSON.stringify(['zero-vv-split-v1', document,
    split.map(chunk => [chunk.index, chunk.start, chunk.end, chunk.text])])).digest('hex');
  const chunks: VectorVisualizationChunk[] = split.map(chunk => ({ ...chunk,
    id: visualizationChunkId(context.options.scopeId, context.options.index, document.id, revision, chunk.index, contentFingerprint),
    documentId: document.id, status: 'pending', stageId: 'embed', attempt: 1 }));
  await context.update(snapshot => {
    snapshot.ingestion = { ...snapshot.ingestion!, chunks, completedChunks: 0,
      tokenCount: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
      tokenCountApproximate: chunks.some(chunk => chunk.tokenCountApproximate) };
  });
  await context.stage('chunk', 'completed', chunks.length, chunks.length);
  const initialMap = await mapDiagnostic(context, maps.get(false, context.options.assertCurrentAuthority));
  if (initialMap) await context.update(snapshot => { snapshot.map = operationMap(initialMap); });
  if (!chunks.length) {
    await context.stage('embed', 'skipped', 0, 0);
    if (context.options.enrich) await context.stage('enrich', 'skipped', 0, 0);
    await context.stage('index', 'skipped', 0, 0);
    await context.update(snapshot => { snapshot.status = 'completed'; });
    return;
  }
  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);
    const ids = new Set(batch.map(chunk => chunk.id));
    await context.stage('embed', 'waiting', start, chunks.length);
    await context.update(snapshot => {
      snapshot.ingestion = { ...snapshot.ingestion!, currentChunkId: batch[0]!.id,
        chunks: snapshot.ingestion!.chunks.map(chunk => ids.has(chunk.id) ? { ...chunk, status: 'waiting', stageId: 'embed' } : chunk) };
    });
    await context.ensureCurrent();
    const embedded = await awaitVisualizationExternal(context.options.ai.embedMany({
      values: batch.map(chunk => chunk.text), maxParallelCalls: 4, abortSignal: context.signal,
      ...(context.options.embeddingModel ? { model: context.options.embeddingModel } : {}),
      metadata: { operationId: context.snapshot.id, operation: 'visualization.ingestion' },
    }), context.signal);
    if (!Array.isArray(embedded.embeddings) || embedded.embeddings.length !== batch.length) {
      throw new VectorError('VECTOR_OPERATION_FAILED', 'Embedding batch returned invalid cardinality.');
    }
    const vectors = embedded.embeddings.map(vector => validateEmbedding(vector, context.options.dimensions));
    await context.update(snapshot => {
      snapshot.ingestion = { ...snapshot.ingestion!, chunks: snapshot.ingestion!.chunks.map(chunk => {
        const i = batch.findIndex(item => item.id === chunk.id);
        return i < 0 ? chunk : { ...chunk, status: 'running', stageId: context.options.enrich ? 'enrich' : 'index',
          dimensions: context.options.dimensions, embeddingPreview: vectors[i]!.slice(0, 16) };
      }) };
    });
    await context.stage('embed', start + batch.length === chunks.length ? 'completed' : 'waiting', start + batch.length, chunks.length);
    let enrichment: readonly Readonly<Record<string, string | number | boolean | null>>[] = batch.map(() => ({}));
    if (context.options.enrich) {
      await context.stage('enrich', 'waiting', start, chunks.length);
      await context.ensureCurrent();
      enrichment = await awaitVisualizationExternal(context.options.enrich(copy(context.snapshot.ingestion!.chunks.filter(chunk => ids.has(chunk.id))), {
        signal: context.signal, assertCurrentAuthority: context.options.assertCurrentAuthority,
      }), context.signal);
      if (!Array.isArray(enrichment) || enrichment.length !== batch.length) throw invalidEnrichment();
      enrichment.forEach(validateEnrichment);
      await context.stage('enrich', start + batch.length === chunks.length ? 'completed' : 'waiting', start + batch.length, chunks.length);
    }
    const records: VectorRecord[] = batch.map((chunk, i) => ({ id: chunk.id, vector: vectors[i]!, text: chunk.text,
      metadata: { ...enrichment[i], document_id: document.id, source_revision: revision,
        source_content_hash: contentFingerprint,
        chunk_index: chunk.index, title: document.title,
        ...(document.source ? { source_label: document.source.label,
          ...(document.source.id ? { source_id: document.source.id } : {}),
          ...(document.source.abbreviation ? { source_abbreviation: document.source.abbreviation } : {}) } : {}),
        ...(document.clusterId ? { cluster_id: document.clusterId } : {}),
        ...(chunk.section ? { section: chunk.section } : {}) } }));
    await context.update(snapshot => {
      snapshot.ingestion = { ...snapshot.ingestion!, chunks: snapshot.ingestion!.chunks.map(chunk => {
        const i = records.findIndex(record => record.id === chunk.id);
        return i < 0 ? chunk : { ...chunk, status: 'waiting', stageId: 'index',
          metadata: publicMetadata(records[i]!.metadata!, context.options.metadataFields ?? []) };
      }) };
    });
    await context.stage('index', 'waiting', context.snapshot.ingestion!.completedChunks, chunks.length);
    await context.ensureCurrent();
    context.writing = true;
    const acknowledgement = await awaitVisualizationExternal(context.options.vectors.upsert(records), context.signal);
    const accepted = acceptedRecordIds(acknowledgement, records);
    context.writing = false;
    context.unpublishedWrites = accepted.size > 0;
    const storedAt = time(context.options);
    await context.update(snapshot => {
      const next = snapshot.ingestion!.chunks.map(chunk => accepted.has(chunk.id)
        ? { ...chunk, status: 'completed' as const, stageId: 'index' as const, storedAt }
        : ids.has(chunk.id) ? { ...chunk, status: 'failed' as const, stageId: 'index' as const } : chunk);
      snapshot.ingestion = { ...snapshot.ingestion!, chunks: next,
        completedChunks: next.filter(chunk => chunk.storedAt !== undefined).length };
    });
    context.unpublishedWrites = false;
    if (accepted.size !== records.length) {
      throw new VectorError('VECTOR_OPERATION_FAILED', 'Some vector records were not acknowledged.', { partial: true });
    }
    const map = await mapDiagnostic(context, maps.accept(records as StoredVectorRecord[], context.options.assertCurrentAuthority));
    if (map) await context.update(snapshot => { snapshot.map = operationMap(map, [...accepted]); });
    await context.stage('index', start + batch.length === chunks.length ? 'completed' : 'waiting',
      context.snapshot.ingestion!.completedChunks, chunks.length);
  }
  await context.update(snapshot => { snapshot.status = 'completed'; });
}

function acceptedRecordIds(result: VectorWriteResult, records: readonly VectorRecord[]): Set<string> {
  if (!result || typeof result.ok !== 'boolean' || !Number.isSafeInteger(result.count)
    || result.count < 0 || result.count > records.length || !Array.isArray(result.errors)) throw unknownWrite();
  if (result.ok && result.count === records.length && !result.errors.length) return new Set(records.map(record => record.id));
  const all = new Set(records.map(record => record.id));
  const failed = new Set<string>();
  for (const error of result.errors) {
    if (!error || typeof error.id !== 'string' || !all.has(error.id) || failed.has(error.id)) throw unknownWrite();
    failed.add(error.id);
  }
  if (result.ok || result.count + failed.size !== records.length || failed.size === 0) throw unknownWrite();
  return new Set(records.filter(record => !failed.has(record.id)).map(record => record.id));
}

function validateEnrichment(value: Readonly<Record<string, string | number | boolean | null>>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).length > 32) throw invalidEnrichment();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(key)
      || ['constructor', 'prototype', '__proto__'].includes(key)) throw invalidEnrichment();
    const item = descriptor.value;
    if (item !== null && (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')
      || typeof item === 'string' && item.length > 256 || typeof item === 'number' && !Number.isFinite(item)) throw invalidEnrichment();
  }
}
function publicMetadata(value: Record<string, unknown>, fields: readonly string[]): Readonly<Record<string, string | number | boolean | null>> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const field of fields) {
    const item = value[field];
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) result[field] = item;
    else if (typeof item === 'string') result[field] = item.slice(0, 128);
  }
  return result;
}
function invalidEnrichment(): VectorError { return new VectorError('VECTOR_METADATA_INVALID', 'Enrichment returned invalid bounded metadata.'); }
function unknownWrite(): VectorError { return new VectorError('VECTOR_OPERATION_FAILED', 'Native vector write acknowledgement is incomplete.', { outcomeUnknown: true }); }
