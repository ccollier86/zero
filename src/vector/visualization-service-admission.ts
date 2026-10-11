/**
 * Store admission compatibility: native stores claim atomically. Legacy custom
 * stores serialize only one shared object in one process; independent wrappers
 * or distributed executors must implement the atomic claim contract themselves.
 */
import { VectorError } from './vector-error';
import type { VectorVisualizationClaim, VectorVisualizationStore } from './visualization-store';
import type { VectorVisualizationSnapshot } from './visualization-types';
import { copy, isTerminal } from './visualization-service-context';

const tails = new WeakMap<VectorVisualizationStore, Promise<unknown>>();

/** Only the winning admission receives an operation-bound retirement capability. */
export async function claimVisualizationOperation(store: VectorVisualizationStore,
  snapshot: VectorVisualizationSnapshot): Promise<VectorVisualizationClaim> {
  if (store.claim) return store.claim(snapshot);
  const before = tails.get(store) ?? Promise.resolve();
  const claim = before.then(async (): Promise<VectorVisualizationClaim> => {
    const existing = await store.get(snapshot.id);
    if (existing) return { snapshot: existing, created: false };
    const accepted = copy(await store.create(snapshot));
    return { snapshot: copy(accepted), created: true, retire: async failure => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get(accepted.id);
        if (!current || isTerminal(current.status)) return;
        if (current.createdAt !== accepted.createdAt || current.index !== accepted.index
          || current.kind !== accepted.kind) throw new VectorError('VECTOR_OPERATION_FAILED', 'Operation identity changed during retirement.');
        const updatedAt = new Date().toISOString();
        const next: VectorVisualizationSnapshot = { ...copy(current), revision: current.revision + 1,
          updatedAt, status: 'interrupted', error: { code: 'VECTOR_OPERATION_INTERRUPTED',
            message: 'The operation was retired before completion.', retryable: false,
            ...(failure.outcomeUnknown ? { outcomeUnknown: true } : {}) },
          stages: current.stages.map(stage => isTerminal(stage.status) || ['completed', 'skipped'].includes(stage.status)
            ? stage : { ...stage, status: 'interrupted', completedAt: updatedAt }) };
        if (next.ingestion) next.ingestion = { ...next.ingestion,
          chunks: next.ingestion.chunks.map(chunk => chunk.storedAt ? chunk : { ...chunk, status: 'interrupted' }) };
        try { await store.compareAndSwap(current.id, current.revision, next); return; }
        catch (error) { if (attempt === 7) throw error; }
      }
    } };
  });
  const settled = claim.catch(() => undefined); tails.set(store, settled);
  void settled.finally(() => { if (tails.get(store) === settled) tails.delete(store); });
  return claim;
}
