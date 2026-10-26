/** App-local facade and capability owner. A dedicated subprocess owns batching/source delivery; Fabric owns SQLite. */
import { DatabaseCoordinator, type DatabaseCoordinatorLease } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor } from '../databases/database-operations';
import { createDatabaseObservability } from '../databases/database-observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { emitPlatformCodeTo } from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import type { LoggingContext, LoggingEvent, LoggingEventInput, LoggingPage, LoggingQuery, LoggingReadScope, LoggingReceipt, LoggingStream } from './logging-contracts';
import type { ResolvedManagedLoggingConfig } from './logging-managed-config';
import { loggingCaptures } from './logging-config';
import { LoggingError } from './logging-error';
import { LoggingFabricStore } from './logging-fabric-store';
import { loggingRealm } from './logging-realm';
import { captureLoggingEvent, normalizeLoggingEvent } from './logging-validation';
import { LoggingDeliveryProcess } from './logging-delivery-process';
import type { DeliverySourcePort, DeliverySourceRegistration } from './logging-delivery-protocol';
import type { LoggingCheckpoint, LoggingEvidenceCursor, LoggingEvidencePage, LoggingVerification } from './logging-evidence-contracts';
import { LoggingAdmission } from './logging-admission';
import { LoggingCheckpointCustody } from './logging-custody';
import { LoggingExportManager } from './logging-export-manager';
import type { OwnedLoggingExportJob } from './logging-export-realm';
import type { StoragePrivateObjects } from '../storage/storage-private-objects';
import { markLocalLoggingIdentityEstablished, openLocalLoggingIdentity } from './logging-local-identity';
import { createLocalLoggingCustody } from './logging-local-custody';

interface StreamOwner { readonly lease: DatabaseCoordinatorLease; readonly store: LoggingFabricStore }

/** Private composition service, not an authorization facade. Callers must supply trusted attribution and query scope. */
export class LoggingRuntime {
  readonly admission: LoggingAdmission;
  private custody: LoggingCheckpointCustody | null = null;
  private custodyLease: DatabaseCoordinatorLease | null = null;
  private exportOwner: LoggingExportManager | null = null;
  private readonly streams = new Map<LoggingStream, StreamOwner>();
  private delivery: LoggingDeliveryProcess | null = null;
  private state: 'opening' | 'ready' | 'draining' | 'closed' | 'close-failed' = 'opening';
  private closeTask: Promise<void> | null = null;
  private source: { flush(): Promise<void>; diagnostics(): Readonly<{ application: { queued: number; bytes: number }; guardian: { queued: number; bytes: number }; failed: number }> } | null = null;
  private fabricSource: { flush(): Promise<void>; diagnostics(): Readonly<{ sources: number; pendingSources: number; queued: number; bytes: number; failed: number }> } | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTask: Promise<void> | null = null;
  private maintenanceFailed = 0;
  private readonly listeners = new Map<LoggingStream, Set<() => void>>();
  private readonly subscriptions = new Set<() => void>();
  private readonly unavailableSources = new Set<object>();

  /** @internal Payload-free committed invalidations; authorized projections must re-read and revalidate. */
  subscribe(stream: LoggingStream, listener: () => void, onClose: () => void): () => void {
    this.assertReady();
    if (!this.streams.has(stream) || this.subscriptions.size >= 256) throw new LoggingError('LOGGING_BACKPRESSURE', 'Logging subscription capacity is exhausted.');
    let entries = this.listeners.get(stream); if (!entries) this.listeners.set(stream, entries = new Set());
    entries.add(listener); this.subscriptions.add(onClose);
    return () => { entries!.delete(listener); this.subscriptions.delete(onClose); };
  }
  private committed(stream: LoggingStream): void { for (const listener of this.listeners.get(stream) ?? []) { try { listener(); } catch { /* Hints cannot fail a committed write. */ } } }
  private retained(event: LoggingEvent): Promise<LoggingReceipt> {
    return this.delivery!.write(event).catch(error => {
      if (event.stream === 'audit' && this.admission.required) this.admission.invalidate();
      throw error;
    });
  }

  /** @internal Same-commit source delivery is installed only by managed composition. */
  attachSource(source: NonNullable<LoggingRuntime['source']>): void { this.source = source; }
  /** @internal Independent managed actor sources are a separate discovery/delivery owner. */
  attachFabricSource(source: NonNullable<LoggingRuntime['fabricSource']>): void { this.fabricSource = source; }
  /** @internal Storage must outlive this owner; managed composition registers dependent cleanup after Storage. */
  attachExportStorage(storage: StoragePrivateObjects): () => Promise<void> {
    this.assertReady(); if (this.exportOwner) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Logging export storage is already bound.');
    const owner = new LoggingExportManager(this, storage); this.exportOwner = owner; owner.start();
    return () => owner.close();
  }
  get exports(): LoggingExportManager | null { return this.exportOwner; }
  /** @internal Publication gate: the preset cannot boot with missing managed source/evidence owners. */
  assertManagedReady(): void {
    this.assertReady();
    if (this.admission.required && (!this.source || !this.custody || !this.exportOwner
      || this.custody.diagnostics().state !== 'ready' || this.delivery?.workerDiagnostics().state !== 'ready')) {
      throw new LoggingError('LOGGING_NOT_READY', 'Required audit sources, checkpoint custody, private exports and delivery workers must be ready before application publication.');
    }
  }
  /** @internal Register a fixed source capability with the separately supervised delivery worker. */
  registerDeliverySource(source: DeliverySourcePort): DeliverySourceRegistration {
    this.assertReady(); const identity = {};
    const failed = () => { this.unavailableSources.add(identity); if (this.admission.required) this.admission.invalidate(); };
    return this.delivery!.registerSource({
      page: async acknowledgments => {
        try { const page = await source.page(acknowledgments); this.unavailableSources.delete(identity); return page; }
        catch (error) { failed(); throw error; }
      },
      failed: () => { failed(); source.failed(); },
    });
  }
  /** @internal Grouped lifecycle fences avoid one shutdown budget per tenant. */
  flushDeliverySources(sources: readonly DeliverySourceRegistration[]): Promise<void> { return this.delivery!.flushSources(sources.map(source => source.id)); }
  closeDeliverySources(sources: readonly DeliverySourceRegistration[]): Promise<void> { return this.delivery!.closeSources(sources.map(source => source.id)); }

  private constructor(readonly config: ResolvedManagedLoggingConfig, private readonly coordinator: DatabaseCoordinator) {
    this.admission = new LoggingAdmission(config.policy.complianceRequested, config.policyVersion, event => this.deliver(event),
      () => performance.now(), 60000, 4096,
      () => this.state === 'ready' && this.unavailableSources.size === 0 && this.delivery?.workerDiagnostics().state === 'ready'
        && (!this.custody || this.custody.diagnostics().state === 'ready'));
  }

  /** Open and probe both private streams before publication. Partial failures release every acquired owner. */
  static async open(config: ResolvedManagedLoggingConfig, fallback: PlatformObservabilityRuntime): Promise<LoggingRuntime> {
    if (config.defaultActorEntrypoint && !await Bun.file(config.defaultActorEntrypoint).exists()) {
      throw new LoggingError('LOGGING_CONFIG_INVALID', 'The packaged logging actor is missing; supply an explicit actor launch in compiled deployments.');
    }
    const coordinator = new DatabaseCoordinator({
      rootDirectory: config.rootDirectory, realm: loggingRealm, createExecutor: config.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: config.custody && 'kind' in config.custody ? 3 : 2,
      maxDatabaseFiles: config.custody && 'kind' in config.custody ? 3 : 2, maxBlockedDatabases: 3,
      maxQueuedPerDatabase: 16, maxQueuedTotal: 32, queueTimeoutMs: 5000, operationTimeoutMs: 10000,
      // Retain the pre-bridge sink. Logging database activity must not log itself recursively.
      sweepIntervalMs: false, observability: createDatabaseObservability({ ...fallback }),
    });
    const owner = new LoggingRuntime(config, coordinator);
    try {
      coordinator.start();
      const local = config.custody && 'kind' in config.custody ? await openLocalLoggingIdentity(config.rootDirectory, config.custody.adoptExisting, config.custody.keyId) : null;
      for (const stream of ['audit', 'operational'] as const) {
        const lease = await coordinator.acquire('logging:' + stream);
        const store = new LoggingFabricStore(createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor }), stream);
        owner.streams.set(stream, { lease, store });
        await store.page({ kind: 'platform' }, { limit: 1 });
      }
      if (config.custody) {
        let custody;
        if ('kind' in config.custody) {
          owner.custodyLease = await coordinator.acquire('logging:checkpoints');
          custody = createLocalLoggingCustody(createAsyncDatabaseClient({ executor: owner.custodyLease as AsyncDatabaseOperationExecutor }), local!, config.custody);
        } else custody = config.custody;
        owner.custody = new LoggingCheckpointCustody(custody, () => owner.admission.invalidate(), local ? 'local-server' : 'configured-store');
        await owner.custody.initialize('audit', (after, checkpoint) => owner.streams.get('audit')!.store.verify(after, checkpoint));
        if (local) await markLocalLoggingIdentityEstablished(config.rootDirectory, local);
      }
      owner.delivery = await LoggingDeliveryProcess.open(config.createExecutor, config.policy.queue, async (stream, events) => {
        const store = owner.streams.get(stream)!.store;
        let result;
        try { result = await store.append(events); }
        catch (error) { if (stream === 'audit' && owner.admission.required) owner.admission.invalidate(); throw error; }
        if (stream === 'audit') await owner.sealCommittedAudit(store);
        owner.committed(stream); return result;
      }, () => { if (owner.admission.required) owner.admission.invalidate(); emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_DELIVERY_FAILED); });
      owner.state = 'ready';
      if (config.retention.auditDays !== null || config.retention.operationalDays !== null) {
        owner.maintenanceTimer = setInterval(() => { void owner.maintain().catch(() => { owner.maintenanceFailed++; }); }, 60000);
        owner.maintenanceTimer.unref?.();
      }
      return owner;
    } catch (error) {
      try { await owner.close(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Logging startup and cleanup failed.'); }
      throw error;
    }
  }

  /** Capture before awaiting. A null receipt means policy-filtered, never persisted successfully. */
  capture(context: LoggingContext, input: LoggingEventInput, metadataKeys: readonly string[] = []): Promise<LoggingReceipt | null> {
    try {
      this.assertReady();
      const event = captureLoggingEvent(context, input, metadataKeys);
      if (!loggingCaptures(this.config.policy, event)) return Promise.resolve(null);
      return this.retained(event);
    } catch (error) { return Promise.reject(error); }
  }

  /** Internal validated-envelope delivery for atomic source outboxes and fully admitted browser batches. */
  append(input: LoggingEvent): Promise<LoggingReceipt | null> {
    try {
      this.assertReady(); const event = normalizeLoggingEvent(input);
      return loggingCaptures(this.config.policy, event) ? this.retained(event) : Promise.resolve(null);
    } catch (error) { return Promise.reject(error); }
  }

  /** @internal Previously durably admitted evidence survives later capture-policy reductions. */
  deliver(input: LoggingEvent): Promise<LoggingReceipt> {
    try { this.assertReady(); const event = normalizeLoggingEvent(input); return this.retained(event); }
    catch (error) { return Promise.reject(error); }
  }

  /** Internal bounded query. An eventual request facade must supply and revalidate live Guardian scope. */
  async page(stream: LoggingStream, scope: LoggingReadScope, query: LoggingQuery = {}): Promise<LoggingPage> {
    this.assertReady();
    const owner = this.streams.get(stream);
    if (!owner) throw new LoggingError('LOGGING_QUERY_INVALID', 'Logging stream is invalid.');
    return owner.store.page(scope, query);
  }

  /** @internal Fixed private evidence capability; scope is provided by the admitted Guardian facade. */
  async changes(stream: LoggingStream, scope: LoggingReadScope, query: LoggingQuery, afterOrdinal: number) {
    this.assertReady();
    const owner = this.streams.get(stream);
    if (!owner) throw new LoggingError('LOGGING_QUERY_INVALID', 'Logging stream is invalid.');
    return owner.store.changes(scope, query, afterOrdinal);
  }
  /** @internal Fixed private evidence capability; scope is provided by the admitted Guardian facade. */
  async evidence(scope: LoggingReadScope, before?: number | LoggingEvidenceCursor): Promise<LoggingEvidencePage> { this.assertReady(); return this.streams.get('audit')!.store.evidence(scope, before); }
  async evidenceCommand(command: 'logging.hold' | 'logging.review' | 'logging.export.reserve' | 'logging.export.transition', input: Record<string, unknown>): Promise<unknown> {
    this.assertReady(); const store = this.streams.get('audit')!.store;
    let result;
    try { result = await store.evidenceCommand(command, input); }
    catch (error) { if (this.admission.required) this.admission.invalidate(); throw error; }
    await this.sealCommittedAudit(store);
    this.committed('audit'); return result;
  }
  private async sealCommittedAudit(store: LoggingFabricStore): Promise<void> {
    try { await this.custody?.seal('audit', (after, checkpoint) => store.verify(after, checkpoint)); }
    catch (error) {
      if (this.admission.required) this.admission.invalidate();
      // The event/transition has already committed. A checkpoint failure must
      // never be described as a safe-to-repeat, definitely uncommitted write.
      throw new LoggingError(error instanceof LoggingError && error.code === 'LOGGING_INTEGRITY_FAILED' ? error.code : 'LOGGING_OUTCOME_UNKNOWN',
        'Audit state committed but checkpoint acknowledgment is unresolved; reconcile the original operation identity.', 'unknown');
    }
  }
  async exportJob(scope: LoggingReadScope, id: string): Promise<OwnedLoggingExportJob | null> { this.assertReady(); return this.streams.get('audit')!.store.exportJob(scope, id); }
  async pendingExports(): Promise<readonly OwnedLoggingExportJob[]> { this.assertReady(); return this.streams.get('audit')!.store.pendingExports(); }
  async verify(stream: LoggingStream, afterOrdinal = 0, checkpoint?: LoggingCheckpoint): Promise<LoggingVerification> {
    this.assertReady(); const owner = this.streams.get(stream); if (!owner) throw new LoggingError('LOGGING_QUERY_INVALID', 'Invalid logging stream.'); return owner.store.verify(afterOrdinal, checkpoint);
  }
  /** Bounded actor-owned retention work; no SQLite scan or delete is performed on the application thread. */
  maintain(now = Date.now()): Promise<void> {
    if (this.maintenanceTask) return this.maintenanceTask;
    this.assertReady();
    this.maintenanceTask = (async () => {
      for (const [stream, owner] of this.streams) {
        const days = stream === 'audit' ? this.config.retention.auditDays : this.config.retention.operationalDays;
        if (days !== null) for (let i = 0; i < 8; i++) if (await owner.store.prune(Math.max(0, now - days * 86400000)) < 100) break;
      }
    })().finally(() => { this.maintenanceTask = null; });
    return this.maintenanceTask;
  }

  /** Join all currently admitted work, including failed batches, without closing intake. */
  async flush(): Promise<void> { await joinOwned([this.source?.flush() ?? Promise.resolve(), this.fabricSource?.flush() ?? Promise.resolve()]); await this.delivery?.flush(); }

  /** Close admission, drain both streams, release capabilities and join all actor shutdowns exactly once. */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'draining';
    this.admission.close();
    for (const close of [...this.subscriptions]) close();
    this.subscriptions.clear(); this.listeners.clear();
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.closeTask = this.closeOwned();
    return this.closeTask;
  }

  diagnostics() {
    const database = this.coordinator.diagnostics();
    return Object.freeze({ state: this.state, preset: this.config.policy.preset,
      coverage: Object.freeze({ automaticAudit: Boolean(this.source),
        guardianAudit: Boolean(this.source && this.config.policy.capture.security), applicationMutations: Boolean(this.source && this.config.policy.capture.records),
        browserActivity: ['views', 'clipboard', 'printing', 'navigation'].some(f => this.config.policy.capture[f as keyof typeof this.config.policy.capture]) ? 'configured-observation-only' : 'disabled',
        fabricTenantAudit: Boolean(this.fabricSource && this.config.policy.capture.records),
        complianceReady: Boolean(this.admission.required && this.state === 'ready' && this.source && this.exportOwner
          && this.unavailableSources.size === 0 && this.custody?.diagnostics().state === 'ready' && this.delivery?.workerDiagnostics().state === 'ready') }),
      unavailableSources: this.unavailableSources.size,
      sources: this.source?.diagnostics() ?? null,
      fabricSources: this.fabricSource?.diagnostics() ?? null,
      maintenanceFailed: this.maintenanceFailed,
      admission: this.admission.diagnostics(),
      custody: this.custody?.diagnostics() ?? null,
      exports: this.exportOwner?.diagnostics() ?? null,
      deliveryWorker: this.delivery?.workerDiagnostics() ?? null,
      streams: Object.freeze(Object.fromEntries([...this.streams].map(([stream]) => [stream, this.delivery?.diagnostics(stream) ?? { pendingEvents: 0, failed: 0 }]))),
      databases: Object.freeze({ state: database.state, files: database.databaseFiles, activeOperations: database.activeOperations, heldAuthorityLeases: database.heldAuthorityLeases }),
    });
  }

  private assertReady(): void {
    if (this.state !== 'ready') throw new LoggingError('LOGGING_CLOSED', 'Logging runtime is unavailable.');
  }

  private async closeOwned(): Promise<void> {
    const failures: unknown[] = [];
    try { await this.maintenanceTask; } catch (error) { failures.push(error); }
    try { await this.exportOwner?.close(); } catch (error) { failures.push(error); }
    try { await this.delivery?.close(); } catch (error) { failures.push(error); }
    try { await this.custody?.close(); } catch (error) { failures.push(error); }
    try { this.custodyLease?.release(); } catch (error) { failures.push(error); }
    for (const owner of this.streams.values()) {
      try { owner.lease.release(); } catch (error) { failures.push(error); }
    }
    try { await this.coordinator.close(); } catch (error) { failures.push(error); }
    this.state = failures.length ? 'close-failed' : 'closed';
    if (failures.length) throw new AggregateError(failures, 'Logging shutdown failed.');
  }
}

async function joinOwned(tasks: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Logging work failed.');
}
