/** Managed SYSTEM-plane progress, with native vector effects confined to trusted corpus scopes. */
import { createAsyncDatabaseClient } from '../databases/database-client';
import { defineDatabaseRealm } from '../databases/database-realm';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import type { DatabaseRuntime } from '../databases/database-runtime';
import type { AsyncDatabaseClient, AsyncDatabaseOperationExecutor } from '../databases/database-operation-contracts';
import type { AIService } from '../ai/ai-service';
import type { VectorService } from './vector-service';
import type { ResolvedVectorConfig } from './vector-types';
import type { ResolvedVectorVisualizationConfig } from './visualization-config';
import { AsyncVectorVisualizationStore } from './visualization-store';
import { AsyncVectorVisualizationMapStore } from './visualization-store-map';
import { VectorVisualizationService } from './visualization-service';
import { admitVectorVisualizationSchema } from './visualization-admission';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE,
  VECTOR_VISUALIZATION_MAP_SCHEMA, VECTOR_VISUALIZATION_OPERATION_SCHEMA, VECTOR_VISUALIZATION_FEED_SCHEMA } from './visualization-schema';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { emitPlatformCode } from '../observability/sink';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import { databaseReceiptSchemaReady } from '../databases/database-receipt-schema';
import { VectorError } from './vector-error';

export const ZERO_VECTOR_VISUALIZATION = createZeroRuntimeServiceKey<ManagedVectorVisualization>('Vector visualization operations');
const realm = defineDatabaseRealm({ name: 'zero-vector-visualization', version: '1', tables: {
  [VECTOR_VISUALIZATION_OPERATIONS_TABLE]: VECTOR_VISUALIZATION_OPERATION_SCHEMA,
  [VECTOR_VISUALIZATION_MAPS_TABLE]: VECTOR_VISUALIZATION_MAP_SCHEMA,
  [VECTOR_VISUALIZATION_FEED_TABLE]: VECTOR_VISUALIZATION_FEED_SCHEMA,
} });

/** Infrastructure owner, never itself an unscoped request capability. */
export class ManagedVectorVisualization {
  private readonly engine: DatabaseWriterOperationEngine;
  private readonly client: AsyncDatabaseClient;
  private readonly active = new Map<string, { service: VectorVisualizationService; abort: AbortController }>();
  private closed = false;
  private starting = 0;
  private readonly pending = new Set<{ service: VectorVisualizationService; abort: AbortController }>();
  private admissionsDrained: (() => void) | null = null;
  private closeTask: Promise<void> | null = null;
  constructor(private readonly options: {
    runtime: DatabaseRuntime; installAllowed: boolean; config: ResolvedVectorVisualizationConfig;
    vectorConfig: ResolvedVectorConfig; ai: AIService; vectors: VectorService; emitCode?: typeof emitPlatformCode;
  }) {
    admitVectorVisualizationSchema(options.runtime.db, options.installAllowed);
    if (!options.installAllowed && !databaseReceiptSchemaReady(options.runtime.db)) throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector visualization writer receipts are not provisioned; migrate:false cannot initialize them.');
    // Same pinned writer authority/ReactiveDB; no second connection or database.
    this.engine = new DatabaseWriterOperationEngine({ runtime: options.runtime, realm });
    const execute = (async (operation: Parameters<AsyncDatabaseOperationExecutor['execute']>[0]) => this.engine.execute(operation)) as AsyncDatabaseOperationExecutor['execute'];
    this.client = createAsyncDatabaseClient({ executor: { execute } });
  }
  scoped(index: string, scope: ServiceDataScope, ownerUserId: string, assertCurrentAuthority: () => void): VectorVisualizationService {
    assertCurrentAuthority();
    if (this.closed) throw new Error('Vector visualization runtime is closed.');
    const policy = this.options.config.indexes[index]!;
    const native = this.options.vectorConfig.indexes[index]!;
    if (!policy || !native) throw new Error('Vector visualization index is unavailable.');
    const scopeId = serviceDataScopeKey(scope);
    const assertBoundAuthority = () => { assertCurrentAuthority(); if (this.closed) throw new VectorError('VECTOR_OPERATION_FAILED', 'Vector visualization runtime is closed.'); };
    return new VectorVisualizationService({ index, scopeId, dimensions: native.dimensions, metric: native.metric,
      embeddingModel: policy.embeddingModel, rerankingModel: policy.rerankingModel,
      sampleSize: policy.sampleSize, chunk: policy.chunk, metadataFields: policy.metadataFields, lexicalEnabled: native.lexical,
      ai: this.options.ai, vectors: this.options.vectors.scope(index, { [policy.scopeField]: scopeId }),
      store: new AsyncVectorVisualizationStore(this.client, scopeId, ownerUserId, scope.tenantId),
      maps: new AsyncVectorVisualizationMapStore(this.client, scopeId), assertCurrentAuthority: assertBoundAuthority, emitCode: this.options.emitCode });
  }
  /** Bounded app-wide admission; readers/cancellation remain available at capacity. */
  reserveStart(service: VectorVisualizationService, abort: AbortController): () => void {
    if (this.closed || this.active.size + this.starting >= 32) throw new VectorError('VECTOR_BACKPRESSURE', 'Vector visualization execution capacity is exhausted.');
    this.starting++; const entry = { service, abort }; this.pending.add(entry); let released = false;
    return () => { if (!released) { released = true; this.pending.delete(entry); this.starting--; if (!this.starting) { this.admissionsDrained?.(); this.admissionsDrained = null; } } };
  }
  /** Retain effect-owning services only until their accepted operation settles. */
  retain(id: string, service: VectorVisualizationService, completion: Promise<unknown>, abort: AbortController): void {
    // Replays may observe a runner admitted by another request before retain()
    // publishes that runner here. An observer must never occupy its slot or
    // dispose the actual effect owner; HTTP/Sync already own replay observation.
    if (!service.ownsOperation(id)) {
      void completion.catch(() => {});
      void service.dispose().catch(() => {});
      return;
    }
    const previous = this.active.get(id);
    if (previous) {
      if (previous.service === service) return;
      if (previous.service.ownsOperation(id)) { void service.dispose().catch(() => {}); return; }
      // The prior execution has settled; a separately admitted recovery attempt
      // may now own this ID before its predecessor's cleanup microtask finishes.
      this.active.delete(id);
      void previous.service.dispose().catch(() => {});
    }
    const entry = { service, abort }; this.active.set(id, entry);
    if (this.closed) abort.abort();
    void completion.finally(async () => { if (this.active.get(id) === entry) this.active.delete(id); await service.dispose(); }).catch(() => {});
  }
  /** Call only after a currently authorized owner has durably cancelled this ID. */
  abortAccepted(id: string): void { this.active.get(id)?.abort.abort(); }
  /** Crash recovery never guesses that effects succeeded or starts provider work again. */
  async recoverInterrupted(): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const page = (await this.client.list(VECTOR_VISUALIZATION_OPERATIONS_TABLE, { limit: 100, ...(after ? { after } : {}) })).value;
      for (const row of page.rows) {
        if (!['pending', 'running', 'waiting'].includes(String(row.status))) continue;
        const store = new AsyncVectorVisualizationStore(this.client, String(row.scope_id), String(row.owner_user_id), typeof row.tenant_id === 'string' ? row.tenant_id : null);
        const current = await store.get(String(row.operation_id)); if (!current) continue;
        await store.compareAndSwap(current.id, current.revision, { ...current, revision: current.revision + 1,
          updatedAt: new Date().toISOString(), status: 'interrupted',
          stages: current.stages.map(stage => ['pending', 'running', 'waiting'].includes(stage.status) ? { ...stage, status: 'interrupted' } : stage),
          error: { code: 'VECTOR_OPERATION_INTERRUPTED', message: 'The operation was interrupted. Native effects may have occurred; reconcile before retrying.', retryable: false, outcomeUnknown: current.kind === 'ingestion' } });
      }
      if (!page.nextCursor) break; after = page.nextCursor;
    }
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    const task = this.drain(); this.closeTask = task;
    void task.catch(() => { if (this.closeTask === task) this.closeTask = null; }); return task;
  }
  private async drain(): Promise<void> {
    for (const entry of this.pending) entry.abort.abort();
    for (const entry of this.active.values()) entry.abort.abort();
    if (this.starting) await new Promise<void>(resolve => { this.admissionsDrained = resolve; });
    const outcomes = await Promise.allSettled([...this.active.values()].map(entry => entry.service.dispose()));
    const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
    try { this.engine.close(); } catch (error) { failures.push(error); }
    this.active.clear();
    if (failures.length) throw new VectorError('VECTOR_OPERATION_FAILED', 'Vector visualization cleanup could not settle all resources.', { phase: 'cleanup' });
  }
}
