/**
 * visualization-service-context.ts
 *
 * Defines the authorized coordinator dependencies and one operation's durable
 * publication fence. It never chooses a tenant, renders motion, or opens an index.
 */
import type { AIService } from '../ai/ai-service';
import type { VectorScope } from './vector-service';
import type { VectorMetric } from './vector-types';
import { VectorError } from './vector-error';
import type { VisualizationChunkOptions } from './visualization-chunker';
import type { VectorVisualizationMapStore } from './visualization-store-map';
import type { VectorVisualizationStore } from './visualization-store';
import type { VectorVisualizationChunk, VectorVisualizationSnapshot, VectorVisualizationStageId } from './visualization-types';
import type { emitPlatformCode } from '../observability/sink';

/** Bound authority and services; callers cannot select a database or corpus through commands. */
export interface VectorVisualizationServiceOptions {
  index: string;
  scopeId: string;
  dimensions: number;
  metric?: VectorMetric;
  embeddingModel?: string;
  rerankingModel?: string;
  lexicalEnabled?: boolean;
  ai: Pick<AIService, 'embed' | 'embedMany' | 'rerank'>;
  vectors: Pick<VectorScope, 'query' | 'fetch' | 'upsert'>;
  store: VectorVisualizationStore;
  maps?: VectorVisualizationMapStore;
  /** Revalidate the live Guardian grant before every effect and delivery. */
  assertCurrentAuthority: () => void;
  emitCode?: typeof emitPlatformCode;
  chunk?: VisualizationChunkOptions;
  sampleSize?: number;
  metadataFields?: readonly string[];
  /** Optional actual enrichment, never inferred from animation time. */
  enrich?: (chunks: readonly VectorVisualizationChunk[], context: {
    signal: AbortSignal; assertCurrentAuthority: () => void;
  }) => Promise<readonly Readonly<Record<string, string | number | boolean | null>>[]>;
  maxActiveOperations?: number;
  now?: () => Date;
}

/** Abort and admission belong to execution, not to presentation pause/replay. */
export interface VectorVisualizationExecutionOptions {
  signal?: AbortSignal;
  /** Optional trusted runtime attempt fence; it can add checks, never replace Guardian. */
  authorityFence?: () => void;
}

/** The accepted snapshot is immediately usable; completion waits for backend work only. */
export interface VectorVisualizationStartedOperation {
  snapshot: VectorVisualizationSnapshot;
  completion: Promise<VectorVisualizationSnapshot>;
}

/** Internal retirement signal, not a provider error or browser-facing exception. */
export class VisualizationRetired extends Error {
  constructor() { super('Visualization operation has been retired.'); }
}

/** One writer publishes monotonically, checking persisted cancellation after external waits. */
export class VisualizationOperationContext {
  writing = false;
  unpublishedWrites = false;
  constructor(readonly options: VectorVisualizationServiceOptions,
    public snapshot: VectorVisualizationSnapshot, readonly controller: AbortController) {}

  get signal(): AbortSignal { return this.controller.signal; }

  /** A new service instance can retire this run through the same durable row. */
  async ensureCurrent(): Promise<void> {
    this.options.assertCurrentAuthority();
    if (this.signal.aborted) throw new VisualizationRetired();
    const accepted = await this.options.store.get(this.snapshot.id);
    this.options.assertCurrentAuthority();
    if (this.signal.aborted || !accepted || isTerminal(accepted.status)
      || accepted.revision !== this.snapshot.revision) throw new VisualizationRetired();
  }

  async update(change: (snapshot: VectorVisualizationSnapshot) => void): Promise<void> {
    await this.ensureCurrent();
    const next = copy(this.snapshot);
    change(next);
    next.revision += 1;
    next.updatedAt = time(this.options);
    this.options.assertCurrentAuthority();
    if (this.signal.aborted) throw new VisualizationRetired();
    this.snapshot = await this.options.store.compareAndSwap(next.id, this.snapshot.revision, next);
  }

  async stage(id: VectorVisualizationStageId, status: 'running' | 'waiting' | 'completed' | 'skipped',
    completed?: number, total?: number): Promise<void> {
    await this.update(snapshot => {
      snapshot.status = 'running';
      snapshot.stages = snapshot.stages.map(stage => stage.id !== id ? stage : {
        ...stage, status,
        ...(!stage.startedAt && status !== 'skipped' ? { startedAt: time(this.options) } : {}),
        ...(status === 'completed' || status === 'skipped' ? { completedAt: time(this.options) } : {}),
        ...(completed === undefined ? {} : { completed }), ...(total === undefined ? {} : { total }),
      });
    });
  }
}

/** Provider adapters that ignore cancellation cannot keep an application promise pending. */
export function awaitVisualizationExternal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new VisualizationRetired());
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new VisualizationRetired()); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

export function isTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
}
export function time(options: VectorVisualizationServiceOptions): string {
  const now = options.now?.() ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new VectorError('VECTOR_CONFIG_INVALID', 'Visualization clock is invalid.');
  }
  return now.toISOString();
}
export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function validateEmbedding(vector: readonly number[], dimensions: number): number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new VectorError('VECTOR_DIMENSION_MISMATCH', 'Embedding does not match the configured index dimension.');
  }
  return [...vector];
}
