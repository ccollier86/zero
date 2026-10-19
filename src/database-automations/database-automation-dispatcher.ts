/** Bounded host scheduler for catalogued durable ReactiveDB function sources. */

import { DatabaseError } from '../databases/database-error';
import type { DatabaseAutomationSourceRecord } from './automation-source-catalog-contract';
import type { DatabaseAutomationSourceCatalog } from './automation-source-catalog-store';
import type { DatabaseAutomationRegistry } from './database-automations';
import type {
  DatabaseAutomationDeliveryEvent,
  DatabaseAutomationDeliverySource,
  DatabaseAutomationExecutionServiceProvider,
} from './database-automation-delivery-contracts';
import { DatabaseAutomationDeliveryWorker } from './database-automation-delivery-worker';

const DEFAULT_SCAN_INTERVAL_MS = 1_000;
const DEFAULT_SOURCE_CONCURRENCY = 8;
const MAX_SOURCE_CONCURRENCY = 64;
const MAX_SCAN_INTERVAL_MS = 300_000;
// A source may contain a slow handler or an effectively unbounded backlog.
// Give every catalogued source one delivery turn before immediately starting
// another complete pass. This keeps backlog throughput continuous without
// letting the first occupied worker slots starve later catalog entries.
const DELIVERIES_PER_SOURCE_PASS = 1;
const MAX_IDLE_SOURCES = 4_096;
const MAX_IDLE_RESCAN_MS = 30_000;

interface IdleSource {
  readonly revision: number;
  emptyPasses: number;
  until: number;
  woken: boolean;
  cooldownMs: number | null;
}

export interface DatabaseAutomationAcquiredSource<TServices> {
  readonly delivery: DatabaseAutomationDeliverySource;
  readonly registry: DatabaseAutomationRegistry;
  readonly services: DatabaseAutomationExecutionServiceProvider<TServices>;
  release(): void | Promise<void>;
}

export interface DatabaseAutomationDispatcherOptions<TServices> {
  readonly catalog: DatabaseAutomationSourceCatalog;
  readonly acquire: (
    source: DatabaseAutomationSourceRecord,
  ) => Promise<DatabaseAutomationAcquiredSource<TServices>>;
  readonly leaseOwner: string;
  readonly scanIntervalMs?: number;
  readonly sourceConcurrency?: number;
  /** @internal Advisory post-commit hints. Periodic scans remain authoritative. */
  readonly subscribe?: (notify: (sourceRef: string) => void) => () => void;
  /** @internal Monotonic clock seam for bounded idle-recovery tests. */
  readonly now?: () => number;
  readonly emit?: (
    source: DatabaseAutomationSourceRecord,
    event: DatabaseAutomationDeliveryEvent,
  ) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Scans the trusted system catalog and drains different physical sources in
 * parallel while retaining one strictly sequential worker per source.
 */
export class DatabaseAutomationDispatcher<TServices> {
  readonly #catalog: DatabaseAutomationSourceCatalog;
  readonly #acquire: DatabaseAutomationDispatcherOptions<TServices>['acquire'];
  readonly #leaseOwner: string;
  readonly #scanIntervalMs: number;
  readonly #sourceConcurrency: number;
  readonly #emit: DatabaseAutomationDispatcherOptions<TServices>['emit'];
  readonly #onError: DatabaseAutomationDispatcherOptions<TServices>['onError'];
  readonly #active = new Map<string, DatabaseAutomationDeliveryWorker<TServices>>();
  readonly #idle = new Map<string, IdleSource>();
  readonly #now: () => number;
  readonly #unsubscribe: (() => void) | undefined;
  #scanTask: Promise<void> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;
  #closed = false;
  #immediateRescanRequested = false;
  #wakeupScheduled = false;

  constructor(options: DatabaseAutomationDispatcherOptions<TServices>) {
    if (!options || typeof options !== 'object'
      || !options.catalog
      || typeof options.acquire !== 'function'
      || (options.subscribe !== undefined && typeof options.subscribe !== 'function')
      || (options.now !== undefined && typeof options.now !== 'function')
      || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u.test(options.leaseOwner)
      || (options.emit !== undefined && typeof options.emit !== 'function')
      || (options.onError !== undefined && typeof options.onError !== 'function')) {
      throw configInvalid('Database automation dispatcher options are invalid.');
    }
    this.#catalog = options.catalog;
    this.#acquire = options.acquire;
    this.#leaseOwner = options.leaseOwner;
    this.#scanIntervalMs = boundedInteger(
      options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
      10,
      MAX_SCAN_INTERVAL_MS,
      'scan interval',
    );
    this.#sourceConcurrency = boundedInteger(
      options.sourceConcurrency ?? DEFAULT_SOURCE_CONCURRENCY,
      1,
      MAX_SOURCE_CONCURRENCY,
      'source concurrency',
    );
    this.#emit = options.emit;
    this.#onError = options.onError;
    this.#now = options.now ?? (() => performance.now());
    this.#unsubscribe = options.subscribe?.(sourceRef => this.notifySource(sourceRef));
  }

  /** Begin immediate restart recovery followed by periodic bounded scans. */
  start(): void {
    if (this.#closed) throw closedError();
    if (this.#started) return;
    this.#started = true;
    this.requestScan();
    this.#timer = setInterval(() => this.requestScan(), this.#scanIntervalMs);
    this.#timer.unref?.();
  }

  /** Trigger and await the current complete catalog pass. */
  drainNow(): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    return this.requestScan();
  }

  /** Fence active services, stop new claims, and release every source lease. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    try { this.#unsubscribe?.(); } catch (error) { this.report(error); }
    await Promise.allSettled([...this.#active.values()].map((worker) => worker.close()));
    await this.#scanTask?.catch(() => undefined);
    this.#idle.clear();
  }

  private requestScan(): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    if (this.#scanTask) return this.#scanTask;
    const task = this.scan();
    this.#scanTask = task;
    void task.finally(() => {
      if (this.#scanTask === task) this.#scanTask = null;
      const rescan = this.#immediateRescanRequested;
      this.#immediateRescanRequested = false;
      if (rescan && !this.#closed) void this.requestScan();
    }).catch((error) => this.report(error));
    return task;
  }

  private async scan(): Promise<void> {
    try {
      let cursor = null;
      do {
        if (this.#closed) return;
        const page = this.#catalog.scan({ status: 'active', cursor });
        await this.drainSources(page.sources);
        cursor = page.page.nextCursor;
      } while (cursor !== null);
    } finally {
      // Start cooldown after the complete pass, not each actor's turn. A
      // catalog larger than the pool must not expire its earliest entries
      // before the slow tail finishes and immediately churn them all again.
      const now = this.#now();
      for (const idle of this.#idle.values()) {
        if (idle.cooldownMs === null) continue;
        if (!idle.woken) idle.until = now + idle.cooldownMs;
        idle.cooldownMs = null;
      }
    }
  }

  private async drainSources(
    sources: readonly DatabaseAutomationSourceRecord[],
  ): Promise<void> {
    let next = 0;
    const consume = async (): Promise<void> => {
      while (!this.#closed) {
        const source = sources[next++];
        if (!source) return;
        if (this.#active.has(source.sourceRef)) continue;
        const idle = this.#idle.get(source.sourceRef);
        if (idle?.revision === source.revision && this.#now() < idle.until) continue;
        try {
          await this.drainSource(source);
        } catch (error) {
          this.report(error);
        }
      }
    };
    const count = Math.min(this.#sourceConcurrency, sources.length);
    await Promise.all(Array.from({ length: count }, consume));
  }

  private async drainSource(source: DatabaseAutomationSourceRecord): Promise<void> {
    const previous = this.#idle.get(source.sourceRef);
    const idle: IdleSource = {
      revision: source.revision,
      emptyPasses: previous?.revision === source.revision ? previous.emptyPasses : 0,
      until: 0,
      woken: false,
      cooldownMs: null,
    };
    this.#idle.delete(source.sourceRef);
    if (this.#idle.size >= MAX_IDLE_SOURCES) this.#idle.delete(this.#idle.keys().next().value!);
    this.#idle.set(source.sourceRef, idle);
    const acquired = await this.#acquire(source);
    let worker: DatabaseAutomationDeliveryWorker<TServices> | null = null;
    try {
      if (this.#closed) return;
      worker = new DatabaseAutomationDeliveryWorker({
        source: acquired.delivery,
        registry: acquired.registry,
        services: acquired.services,
        leaseOwner: this.#leaseOwner,
        maxDeliveriesPerDrain: DELIVERIES_PER_SOURCE_PASS,
        emit: (event) => this.emit(source, event),
      });
      this.#active.set(source.sourceRef, worker);
      const result = await worker.drain();
      if (result.claimed === DELIVERIES_PER_SOURCE_PASS) {
        this.#idle.delete(source.sourceRef);
        this.#immediateRescanRequested = true;
      } else if (!this.#closed) {
        // A future retry or live lease is not an empty source. Keep the usual
        // cadence for those; back off only a genuinely drained outbox.
        const counts = await acquired.delivery.counts();
        if (idle.woken) {
          this.#idle.delete(source.sourceRef);
          this.#immediateRescanRequested = true;
        } else if (counts.activeRecords === 0) {
          idle.emptyPasses = Math.min(idle.emptyPasses + 1, 16);
          idle.cooldownMs = Math.min(MAX_IDLE_RESCAN_MS,
            this.#scanIntervalMs * 2 ** idle.emptyPasses);
        } else {
          this.#idle.delete(source.sourceRef);
        }
      }
    } finally {
      if (worker) {
        this.#active.delete(source.sourceRef);
        await worker.close().catch((error) => this.report(error));
      }
      await Promise.resolve(acquired.release()).catch((error) => this.report(error));
    }
  }

  private notifySource(sourceRef: string): void {
    if (this.#closed) return;
    const idle = this.#idle.get(sourceRef);
    if (idle) { idle.woken = true; idle.until = 0; idle.emptyPasses = 0; }
    if (this.#scanTask) this.#immediateRescanRequested = true;
    else if (this.#started && !this.#wakeupScheduled) {
      this.#wakeupScheduled = true;
      // A commit listener is advisory: do not scan the catalog on its SQL
      // completion stack, or schedule one scan for every row in a bulk write.
      queueMicrotask(() => {
        this.#wakeupScheduled = false;
        if (this.#closed) return;
        if (this.#scanTask) this.#immediateRescanRequested = true;
        else void this.requestScan().catch(error => this.report(error));
      });
    }
  }

  private emit(
    source: DatabaseAutomationSourceRecord,
    event: DatabaseAutomationDeliveryEvent,
  ): void {
    try {
      this.#emit?.(source, event);
    } catch {
      // Observability cannot change the durable delivery state.
    }
  }

  private report(error: unknown): void {
    try {
      this.#onError?.(error);
    } catch {
      // Error sinks remain advisory; the next scan continues recovery.
    }
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum) {
    throw configInvalid(`Database automation ${field} is invalid.`);
  }
  return value as number;
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message, {
    retryable: false,
    outcome: 'not-started',
    details: { component: 'database-automation-dispatcher' },
  });
}

function closedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Database automation dispatcher is closed.',
  );
}
