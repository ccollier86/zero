/** App-local logging owner. Fabric owns SQLite execution; no application auth lease is held across delivery. */
import { DatabaseCoordinator, type DatabaseCoordinatorLease } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor } from '../databases/database-operations';
import { createDatabaseObservability } from '../databases/database-observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { LoggingContext, LoggingEventInput, LoggingPage, LoggingQuery, LoggingReadScope, LoggingReceipt, LoggingStream } from './logging-contracts';
import type { ResolvedManagedLoggingConfig } from './logging-managed-config';
import { loggingCaptures } from './logging-config';
import { LoggingError } from './logging-error';
import { LoggingFabricStore } from './logging-fabric-store';
import { loggingRealm } from './logging-realm';
import { captureLoggingEvent } from './logging-validation';
import { LoggingWriter } from './logging-writer';

interface StreamOwner { readonly lease: DatabaseCoordinatorLease; readonly store: LoggingFabricStore; readonly writer: LoggingWriter }

/** Private composition service, not an authorization facade. Callers must supply trusted attribution and query scope. */
export class LoggingRuntime {
  private readonly streams = new Map<LoggingStream, StreamOwner>();
  private state: 'opening' | 'ready' | 'draining' | 'closed' | 'close-failed' = 'opening';
  private closeTask: Promise<void> | null = null;

  private constructor(readonly config: ResolvedManagedLoggingConfig, private readonly coordinator: DatabaseCoordinator) {}

  /** Open and probe both private streams before publication. Partial failures release every acquired owner. */
  static async open(config: ResolvedManagedLoggingConfig, fallback: PlatformObservabilityRuntime): Promise<LoggingRuntime> {
    if (config.defaultActorEntrypoint && !await Bun.file(config.defaultActorEntrypoint).exists()) {
      throw new LoggingError('LOGGING_CONFIG_INVALID', 'The packaged logging actor is missing; supply an explicit actor launch in compiled deployments.');
    }
    const coordinator = new DatabaseCoordinator({
      rootDirectory: config.rootDirectory, realm: loggingRealm, createExecutor: config.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: 2, maxDatabaseFiles: 2, maxBlockedDatabases: 2,
      maxQueuedPerDatabase: 16, maxQueuedTotal: 32, queueTimeoutMs: 5000, operationTimeoutMs: 10000,
      // Retain the pre-bridge sink. Logging database activity must not log itself recursively.
      sweepIntervalMs: false, observability: createDatabaseObservability({ ...fallback }),
    });
    const owner = new LoggingRuntime(config, coordinator);
    try {
      coordinator.start();
      for (const stream of ['audit', 'operational'] as const) {
        const lease = await coordinator.acquire('logging:' + stream);
        const store = new LoggingFabricStore(createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor }), stream);
        owner.streams.set(stream, { lease, store, writer: new LoggingWriter(store, config.policy.queue) });
        await store.page({ kind: 'platform' }, { limit: 1 });
      }
      owner.state = 'ready';
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
      return this.streams.get(event.stream)!.writer.write(event);
    } catch (error) { return Promise.reject(error); }
  }

  /** Internal bounded query. An eventual request facade must supply and revalidate live Guardian scope. */
  async page(stream: LoggingStream, scope: LoggingReadScope, query: LoggingQuery = {}): Promise<LoggingPage> {
    this.assertReady();
    const owner = this.streams.get(stream);
    if (!owner) throw new LoggingError('LOGGING_QUERY_INVALID', 'Logging stream is invalid.');
    return owner.store.page(scope, query);
  }

  /** Join all currently admitted work, including failed batches, without closing intake. */
  async flush(): Promise<void> { await joinOwned([...this.streams.values()].map(owner => owner.writer.flush())); }

  /** Close admission, drain both streams, release capabilities and join all actor shutdowns exactly once. */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'draining';
    this.closeTask = this.closeOwned();
    return this.closeTask;
  }

  diagnostics() {
    const database = this.coordinator.diagnostics();
    return Object.freeze({ state: this.state, preset: this.config.policy.preset,
      coverage: Object.freeze({ automaticAudit: false, browserActivity: false, complianceReady: false }),
      streams: Object.freeze(Object.fromEntries([...this.streams].map(([stream, owner]) => [stream, owner.writer.diagnostics()]))),
      databases: Object.freeze({ state: database.state, files: database.databaseFiles, activeOperations: database.activeOperations, heldAuthorityLeases: database.heldAuthorityLeases }),
    });
  }

  private assertReady(): void {
    if (this.state !== 'ready') throw new LoggingError('LOGGING_CLOSED', 'Logging runtime is unavailable.');
  }

  private async closeOwned(): Promise<void> {
    const failures: unknown[] = [];
    try { await joinOwned([...this.streams.values()].map(owner => owner.writer.stop())); } catch (error) { failures.push(error); }
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
