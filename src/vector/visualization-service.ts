/**
 * visualization-service.ts
 *
 * Authorized facade for real ingestion/search operations and their durable
 * public-safe progress. Existing AI, VectorScope and asynchronous database
 * services own provider calls, native storage and actor/Fabric routing.
 */
import { createHash } from 'node:crypto';
import { VectorError } from './vector-error';
import { emitVectorOperationCompleted, emitVectorOperationFailed } from './vector-observability';
import { runVisualizationIngestion } from './visualization-service-ingestion';
import { runVisualizationSearch } from './visualization-service-search';
import { VectorVisualizationMapCoordinator } from './visualization-service-map';
import { claimVisualizationOperation } from './visualization-service-admission';
import type { VectorVisualizationClaim } from './visualization-store';
import { VisualizationOperationContext, VisualizationRetired, copy, isTerminal, time,
  type VectorVisualizationExecutionOptions, type VectorVisualizationServiceOptions,
  type VectorVisualizationStartedOperation } from './visualization-service-context';
import type { VectorVisualizationDocument, VectorVisualizationFailure,
  VectorVisualizationIngestInput, VectorVisualizationSearchInput,
  VectorVisualizationSnapshot, VectorVisualizationStage } from './visualization-types';

export type { VectorVisualizationExecutionOptions, VectorVisualizationServiceOptions,
  VectorVisualizationStartedOperation } from './visualization-service-context';

interface ActiveOperation { context: VisualizationOperationContext; completion: Promise<VectorVisualizationSnapshot> }
interface PendingAdmission { controller: AbortController; drained: Promise<void> }

/** A bound corpus/index coordinator; command payloads never grant tenant or provider authority. */
export class VectorVisualizationService {
  private readonly active = new Map<string, ActiveOperation>();
  private readonly observers = new Set<AbortController>();
  private readonly pending = new Set<PendingAdmission>();
  private readonly maps: VectorVisualizationMapCoordinator;
  private disposed = false;
  private disposeTask: Promise<void> | null = null;

  constructor(private readonly options: VectorVisualizationServiceOptions) {
    string(options.index, 128, 'index'); string(options.scopeId, 256, 'scope');
    integer(options.dimensions, 1, 8_192, 'dimensions');
    integer(options.sampleSize ?? 96, 1, 256, 'sampleSize');
    integer(options.maxActiveOperations ?? 16, 1, 128, 'maxActiveOperations');
    if (typeof options.assertCurrentAuthority !== 'function') throw invalid('Live authority assertion is required.');
    this.maps = new VectorVisualizationMapCoordinator(options);
  }

  /** Return an accepted row promptly; presentation and backend completion are independent. */
  async startSearch(input: VectorVisualizationSearchInput,
    execution: VectorVisualizationExecutionOptions = {}): Promise<VectorVisualizationStartedOperation> {
    this.admit(input, ['index', 'text', 'retrieval', 'rerank', 'topK', 'candidateCount', 'operationId'], execution);
    const text = string(input.text, 8_192, 'query').trim();
    if (!text || new TextEncoder().encode(text).byteLength > 8_192) throw invalid('Query text is empty or too large.');
    const retrieval = input.retrieval ?? 'vector';
    if (!['vector', 'hybrid'].includes(retrieval)) throw invalid('Retrieval mode is invalid.');
    if (retrieval === 'hybrid' && !this.options.lexicalEnabled) throw invalid('Hybrid retrieval requires native full-text indexing.');
    if (input.rerank !== undefined && typeof input.rerank !== 'boolean') throw invalid('Rerank must be a boolean.');
    const topK = integer(input.topK ?? 5, 1, 100, 'topK');
    const candidateCount = integer(input.candidateCount ?? Math.min(100, Math.max(topK, topK * 4, 20)), topK, 100, 'candidateCount');
    const query = { text, retrieval, rerank: input.rerank ?? false, topK, candidateCount };
    const snapshot = this.initial('search', input.operationId, [
      stage('query', 'Query', 'completed'), stage('embed', 'Embed query'), stage('retrieve', 'Vector retrieval'),
      stage('lexical', 'Full-text retrieval', retrieval === 'hybrid' ? 'pending' : 'skipped'),
      stage('fusion', 'Rank fusion', retrieval === 'hybrid' ? 'pending' : 'skipped'),
      stage('rerank', 'Rerank', query.rerank ? 'pending' : 'skipped'),
    ]);
    snapshot.query = query;
    return this.start(snapshot, execution, context => runVisualizationSearch(context, this.maps));
  }

  async startIngest(input: VectorVisualizationIngestInput,
    execution: VectorVisualizationExecutionOptions = {}): Promise<VectorVisualizationStartedOperation> {
    this.admit(input, ['index', 'document', 'sourceRevision', 'operationId'], execution);
    record(input.document, ['id', 'title', 'text', 'source', 'clusterId']);
    const document: VectorVisualizationDocument & { text: string } = {
      id: string(input.document.id, 256, 'document'), title: string(input.document.title, 160, 'title'),
      text: sourceText(input.document.text),
      ...(input.document.clusterId === undefined ? {} : { clusterId: string(input.document.clusterId, 64, 'cluster') }),
    };
    if (input.document.source !== undefined) {
      record(input.document.source, ['id', 'label', 'abbreviation']);
      document.source = { label: string(input.document.source.label, 96, 'source label'),
        ...(input.document.source.id === undefined ? {} : { id: string(input.document.source.id, 256, 'source') }),
        ...(input.document.source.abbreviation === undefined ? {} : { abbreviation: string(input.document.source.abbreviation, 16, 'source abbreviation') }) };
    }
    const sourceRevision = input.sourceRevision === undefined
      ? createHash('sha256').update(document.text).digest('hex') : string(input.sourceRevision, 128, 'source revision');
    const snapshot = this.initial('ingestion', input.operationId, [
      stage('accept', 'Accepted document', 'completed'), stage('chunk', 'Chunk'), stage('embed', 'Embed'),
      stage('enrich', 'Enrich', this.options.enrich ? 'pending' : 'skipped'), stage('index', 'Store vectors'),
    ]);
    snapshot.ingestion = { document, sourceRevision, chunks: [], completedChunks: 0,
      tokenCount: 0, tokenCountApproximate: !this.options.chunk?.tokenizer };
    return this.start(snapshot, execution, context => runVisualizationIngestion(context, this.maps));
  }

  /** Tool/app convenience returns backend results, never waits for UI playback. */
  async search(input: VectorVisualizationSearchInput, execution: VectorVisualizationExecutionOptions = {}) {
    const started = await this.startSearch(input, execution);
    const completed = await started.completion;
    this.options.assertCurrentAuthority(); return completed;
  }

  async ingest(input: VectorVisualizationIngestInput, execution: VectorVisualizationExecutionOptions = {}) {
    const started = await this.startIngest(input, execution);
    const completed = await started.completion;
    this.options.assertCurrentAuthority(); return completed;
  }

  async get(id: string): Promise<VectorVisualizationSnapshot | null> {
    this.options.assertCurrentAuthority();
    const snapshot = await this.options.store.get(string(id, 128, 'operation'));
    this.options.assertCurrentAuthority();
    return snapshot?.index === this.options.index ? snapshot : null;
  }

  async list(limit = 20) {
    this.options.assertCurrentAuthority();
    const snapshots = await this.options.store.list(this.options.index, limit);
    this.options.assertCurrentAuthority(); return snapshots;
  }

  /** @internal Infrastructure ownership only; observers never own native/provider execution. */
  ownsOperation(id: string): boolean { return this.active.has(id); }

  async map(refresh = false) {
    if (this.disposed) throw invalid('Visualization service is disposed.');
    this.options.assertCurrentAuthority();
    const map = await this.maps.get(refresh);
    this.options.assertCurrentAuthority(); return map;
  }

  /** Durable cancellation also fences a run owned by another service instance. */
  async cancel(id: string): Promise<VectorVisualizationSnapshot | null> {
    const current = await this.get(id);
    if (!current || isTerminal(current.status)) return current;
    const active = this.active.get(id);
    active?.context.controller.abort();
    const settled = await this.settle(current, 'cancelled', { code: 'VECTOR_OPERATION_CANCELLED',
      message: 'Operation was cancelled.',
      ...(active?.context.writing || active?.context.unpublishedWrites
        || current.kind === 'ingestion' && current.stages.some(item => item.id === 'index' && ['running', 'waiting'].includes(item.status))
        ? { outcomeUnknown: true } : {}) });
    this.options.assertCurrentAuthority(); return settled;
  }

  /** Dispose cancels only operations this service started, and drains their completion handlers. */
  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    this.disposed = true;
    this.observers.forEach(observer => observer.abort());
    this.pending.forEach(admission => admission.controller.abort());
    this.active.forEach(operation => operation.context.controller.abort());
    this.disposeTask = (async () => {
      await Promise.allSettled([...this.pending].map(admission => admission.drained));
      await Promise.allSettled([...this.active.values()].map(operation => operation.completion));
    })();
    return this.disposeTask;
  }

  private admit(input: object, fields: readonly string[], execution: VectorVisualizationExecutionOptions): void {
    if (this.disposed) throw invalid('Visualization service is disposed.');
    this.options.assertCurrentAuthority(); record(input, fields);
    execution.authorityFence?.();
    const index = (input as { index?: string }).index;
    if (index !== undefined && index !== this.options.index) throw invalid('Command index is not the authorized index.');
    if (execution.signal?.aborted) throw new VisualizationRetired();
  }

  private initial(kind: 'search' | 'ingestion', operationId: string | undefined,
    stages: VectorVisualizationStage[]): VectorVisualizationSnapshot {
    const at = time(this.options);
    return { id: operationId === undefined ? `vv${kind}_${crypto.randomUUID()}` : string(operationId, 128, 'operation'),
      kind, index: this.options.index, status: 'pending', revision: 1, createdAt: at, updatedAt: at,
      stages: stages.map(item => ['completed', 'skipped'].includes(item.status) ? { ...item, completedAt: at,
        ...(item.status === 'completed' ? { startedAt: at } : {}) } : item) };
  }

  private async start(snapshot: VectorVisualizationSnapshot, execution: VectorVisualizationExecutionOptions,
    run: (context: VisualizationOperationContext) => Promise<void>): Promise<VectorVisualizationStartedOperation> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    execution.signal?.addEventListener('abort', abort, { once: true });
    if (execution.signal?.aborted || this.disposed) controller.abort();
    let release!: () => void;
    const admission = { controller, drained: new Promise<void>(resolve => { release = resolve; }) };
    this.pending.add(admission);
    let claimed: VectorVisualizationClaim | undefined;
    let ownsRunner = false;
    const assertAdmission = () => {
      if (this.disposed || controller.signal.aborted) throw new VisualizationRetired();
      this.options.assertCurrentAuthority(); execution.authorityFence?.();
    };
    try {
      assertAdmission();
      const existing = await this.get(snapshot.id);
      assertAdmission();
      if (existing) {
        if (!sameCommand(existing, snapshot)) throw invalid('Operation identity cannot be reused with different inputs.');
        return { snapshot: existing, completion: this.deliver(this.active.get(snapshot.id)?.completion
          ?? (isTerminal(existing.status) ? Promise.resolve(existing) : this.observeCompletion(existing.id, execution.signal)), execution.authorityFence) };
      }
      if (this.active.size + this.pending.size > (this.options.maxActiveOperations ?? 16)) {
        throw new VectorError('VECTOR_BACKPRESSURE', 'Visualization execution capacity is exhausted.');
      }
      claimed = await claimVisualizationOperation(this.options.store, snapshot);
      assertAdmission();
      const accepted = claimed.snapshot;
      if (!sameCommand(accepted, snapshot)) throw invalid('Operation identity cannot be reused with different inputs.');
      if (!claimed.created) return { snapshot: copy(accepted), completion: this.deliver(this.active.get(snapshot.id)?.completion
        ?? (isTerminal(accepted.status) ? Promise.resolve(accepted) : this.observeCompletion(accepted.id, execution.signal)), execution.authorityFence) };
      const context = new VisualizationOperationContext({ ...this.options, assertCurrentAuthority: () => {
        this.options.assertCurrentAuthority(); execution.authorityFence?.();
      } }, accepted, controller);
      const executionCompletion = Promise.resolve().then(async () => {
        try {
          await run(context);
          emitVectorOperationCompleted({ index: this.options.index, operation: `visualization.${snapshot.kind}`,
            documents: context.snapshot.ingestion?.completedChunks ?? context.snapshot.results?.length ?? 0 }, this.options.emitCode);
          return copy(context.snapshot);
        } catch (error) {
          const current = await this.options.store.get(snapshot.id).catch(() => null);
          if (current && isTerminal(current.status)) return current;
          const failure = safeFailure(error, context);
          emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', failure.message), {
            index: this.options.index, operation: `visualization.${snapshot.kind}`,
          }, this.options.emitCode);
          try {
            execution.authorityFence?.();
            return await this.settle(current ?? context.snapshot,
              controller.signal.aborted || error instanceof VisualizationRetired ? 'cancelled' : 'failed', failure);
          } catch {
            // A revoked request cannot rewrite progress. Its winning admission's
            // narrow lifecycle capability may only retire that exact owned row.
            try {
              await claimed?.retire?.(failure);
              const retired = await this.options.store.get(snapshot.id);
              if (retired && isTerminal(retired.status)) return retired;
            } catch {
              emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', 'Operation retirement could not be persisted.'),
                { index: this.options.index, operation: 'visualization.retire' }, this.options.emitCode);
            }
            return { ...copy(current ?? context.snapshot), status: 'interrupted' as const, error: failure };
          }
        } finally {
          execution.signal?.removeEventListener('abort', abort);
          this.active.delete(snapshot.id);
        }
      });
      const completion = this.deliver(executionCompletion, execution.authorityFence);
      this.active.set(snapshot.id, { context, completion });
      ownsRunner = true;
      return { snapshot: copy(accepted), completion };
    } catch (error) {
      if (claimed?.created && !ownsRunner) {
        try { await claimed.retire?.({ code: 'VECTOR_OPERATION_INTERRUPTED', message: 'Operation admission was retired.', retryable: false }); }
        catch { emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', 'Operation retirement could not be persisted.'),
          { index: this.options.index, operation: 'visualization.retire' }, this.options.emitCode); }
      }
      throw error;
    } finally {
      this.pending.delete(admission); release();
      if (!ownsRunner) execution.signal?.removeEventListener('abort', abort);
    }
  }

  private deliver(work: Promise<VectorVisualizationSnapshot>, authorityFence?: () => void): Promise<VectorVisualizationSnapshot> {
    const completion = work.then(result => {
      try { this.options.assertCurrentAuthority(); authorityFence?.(); }
      catch { throw new VectorError('VECTOR_SCOPE_CONFLICT', 'Operation authority is no longer current.'); }
      return result;
    });
    // Fire-and-observe 202 callers may attach through Sync instead of awaiting
    // this handle. A handled rejection still propagates to callers who await it.
    void completion.catch(() => undefined);
    return completion;
  }

  private async settle(current: VectorVisualizationSnapshot,
    status: 'failed' | 'cancelled', error: VectorVisualizationFailure, attempt = 0): Promise<VectorVisualizationSnapshot> {
    this.options.assertCurrentAuthority();
    const next = { ...copy(current), revision: current.revision + 1, updatedAt: time(this.options), status, error,
      stages: current.stages.map(item => ['completed', 'skipped'].includes(item.status) ? item : {
        ...item, status: item.status === 'pending' ? 'skipped' as const : status, completedAt: time(this.options),
      }) };
    if (next.ingestion) next.ingestion.chunks = next.ingestion.chunks.map(chunk => chunk.storedAt ? chunk
      : { ...chunk, status });
    try { return await this.options.store.compareAndSwap(current.id, current.revision, next); }
    catch (cause) {
      const winner = await this.get(current.id);
      if (winner && isTerminal(winner.status)) return winner;
      if (winner && winner.revision > current.revision && attempt < 3) return this.settle(winner, status, error, attempt + 1);
      throw cause;
    }
  }

  private async observeCompletion(id: string, signal?: AbortSignal): Promise<VectorVisualizationSnapshot> {
    const controller = new AbortController();
    this.observers.add(controller);
    const retire = () => controller.abort();
    signal?.addEventListener('abort', retire, { once: true });
    if (signal?.aborted || this.disposed) controller.abort();
    try { return await this.observeAccepted(id, controller.signal); }
    finally {
      this.observers.delete(controller);
      signal?.removeEventListener('abort', retire);
    }
  }

  private async observeAccepted(id: string, signal: AbortSignal): Promise<VectorVisualizationSnapshot> {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new VisualizationRetired();
      const current = await this.get(id);
      if (!current) throw invalid('Operation is no longer available.');
      if (isTerminal(current.status)) return current;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 250);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new VisualizationRetired()); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    throw new VectorError('VECTOR_BACKPRESSURE', 'Operation is still running; attach to its accepted progress.');
  }
}

function sameCommand(a: VectorVisualizationSnapshot, b: VectorVisualizationSnapshot): boolean {
  if (a.index !== b.index || a.kind !== b.kind) return false;
  if (a.kind === 'ingestion') return JSON.stringify([a.ingestion?.document, a.ingestion?.sourceRevision])
    === JSON.stringify([b.ingestion?.document, b.ingestion?.sourceRevision]);
  const fields = ['text', 'retrieval', 'rerank', 'topK', 'candidateCount'] as const;
  return fields.every(field => a.query?.[field] === b.query?.[field]);
}
function safeFailure(error: unknown, context: VisualizationOperationContext): VectorVisualizationFailure {
  const cancelled = context.signal.aborted || error instanceof VisualizationRetired;
  const domain = error instanceof VectorError ? error : null;
  return { code: cancelled ? 'VECTOR_OPERATION_CANCELLED' : domain?.code ?? 'VECTOR_OPERATION_FAILED',
    message: cancelled ? 'Operation was cancelled.' : domain?.code === 'VECTOR_DIMENSION_MISMATCH'
      ? 'Embedding dimensions do not match the configured index.' : 'Operation could not be completed.',
    retryable: !cancelled, ...(context.writing || context.unpublishedWrites || domain?.metadata.outcomeUnknown === true ? { outcomeUnknown: true } : {}) };
}
function sourceText(value: string): string {
  if (typeof value !== 'string' || value.includes('\0') || new TextEncoder().encode(value).byteLength > 48_000) throw invalid('Document text exceeds the bounded ingestion input.');
  return value;
}
function string(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) throw invalid(`Visualization ${label} is invalid.`);
  return value;
}
function integer(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalid(`Visualization ${label} is out of bounds.`);
  return value;
}
function record(value: object, fields: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid('Visualization command must be a plain object.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key)!)) {
      throw invalid('Visualization command contains unsupported fields.');
    }
  }
}
function stage(id: VectorVisualizationStage['id'], label: string,
  status: VectorVisualizationStage['status'] = 'pending'): VectorVisualizationStage { return { id, label, status }; }
function invalid(message: string): VectorError { return new VectorError('VECTOR_CONFIG_INVALID', message); }
