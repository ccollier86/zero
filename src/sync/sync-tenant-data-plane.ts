/**
 * Actor-backed tenant data plane for Zero Sync.
 *
 * One instance belongs to one authenticated WebSocket. It owns exactly one
 * persistent tenant binding, pulls durable changes after wakeups, and keeps
 * the actor replay cursor distinct from the last sequence delivered on the
 * wire. Actor wakeups are hints only; snapshot/replay remain the source of
 * truth.
 */

import type { ServerWebSocket } from 'bun';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformObservabilityRuntime,
} from '../observability/types';
import { projectSyncChange } from './row-filter';
import { SyncTenantSnapshotBudgetError } from './sync-tenant-snapshot-budget';
import {
  rejectSyncDrain,
  sendSyncWire,
  waitForSyncDrain,
} from './sync-wire-send';
import type {
  SyncTenantDataPlane,
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneReplayChange,
  SyncTenantDataPlaneTable,
  SyncTenantDataPlaneWakeup,
  SyncTenantMutationCommit,
  SyncTenantMutationReceiptReplay,
} from './sync-tenant-data-plane-contract';
import {
  assertExpectedTenantReceiptChange,
  canonicalChangeFromCommit,
  tenantHistoryGapError,
  validateTenantReplayPage,
} from './sync-tenant-replay-validation';
import {
  assertVerifiedTenantSyncAuthority,
  freezeTenantSyncAuthContext,
  isTerminalTenantSyncSnapshotFailure,
  isTenantSyncAuthorityFailure,
  isTenantSyncDatabaseCapacityExhausted,
  isTenantSyncHistoryGap,
  SyncTenantSubscriptionSupersededError,
  tenantSyncAuthorityChangedError,
  tenantSyncMutationRecoveryError,
  uniqueTenantSyncStrings,
  validateTenantSyncBinding,
  validateTenantSyncTableCatalog,
  validTenantSyncSubscribe,
} from './sync-tenant-data-plane-validation';
import { sendTenantSnapshot } from './sync-tenant-snapshot-transfer';
import { SYNC_TERMINAL_DATA_CLOSE_CODE } from './types';
import type {
  Change,
  Row,
  SyncAckMessage,
  SyncAuthContext,
  SyncCatchupMessage,
  SyncMutateMessage,
  SyncSnapshotMessage,
  SyncSocketData,
  SyncSubscribeMessage,
} from './types';

export type {
  SyncTenantDataPlane,
  SyncTenantDataPlaneBindContext,
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneReplay,
  SyncTenantDataPlaneReplayChange,
  SyncTenantDataPlaneSnapshotPageRow,
  SyncTenantDataPlaneSnapshotSession,
  SyncTenantDataPlaneTable,
  SyncTenantDataPlaneWakeup,
  SyncTenantMutationCommit,
  SyncTenantMutationReceiptReplay,
} from './sync-tenant-data-plane-contract';
export {
  createTenantDatabaseMutation,
  createTenantSyncIdempotencyKey,
  createTenantSyncLogicalReceiptFingerprint,
  isExpiredTenantSyncMutationReceipt,
  requiresTenantSyncMutationRecovery,
} from './sync-tenant-receipt-contract';

const DEFAULT_REPLAY_LIMIT = 500;
const MAX_CATCHUP_WIRE_BYTES = 900_000;
const encoder = new TextEncoder();

interface SyncTenantSocketBridgeOptions {
  readonly socket: ServerWebSocket<SyncSocketData>;
  readonly plane: SyncTenantDataPlane;
  readonly observability?: PlatformObservabilityRuntime | null;
  readonly authContext: SyncAuthContext;
  readonly snapshotTables?: ReadonlySet<string>;
  readonly assertCurrentAuthoritySync: () => undefined;
  readonly assertCurrentReadAuthoritySync?: () => undefined;
  readonly assertMutationAuthoritySync?: (fingerprint: string) => undefined;
}

/** Per-socket owner for a persistent actor tenant binding. */
export class SyncTenantSocketBridge {
  readonly #socket: ServerWebSocket<SyncSocketData>;
  readonly #plane: SyncTenantDataPlane;
  readonly #observability: PlatformObservabilityRuntime | null;
  readonly #authContext: SyncAuthContext;
  readonly #snapshotTables?: ReadonlySet<string>;
  readonly #assertCurrentAuthoritySync: () => undefined;
  readonly #assertCurrentReadAuthoritySync: () => undefined;
  readonly #assertMutationAuthoritySync?: (fingerprint: string) => undefined;
  readonly #tables: Readonly<Record<string, SyncTenantDataPlaneTable>>;

  #binding: SyncTenantDataPlaneBinding | null = null;
  #bindingTask: Promise<SyncTenantDataPlaneBinding> | null = null;
  #bindingRevision = 0;
  #unsubscribe: (() => void) | null = null;
  #disposed = false;
  #baselineReady = false;
  #epoch: string | null = null;
  #generation: number | null = null;
  #actorCursor = 0;
  #lastDeliveredWireSeq = 0;
  #subscribedTables = new Set<string>();
  #pumpTask: Promise<void> | null = null;
  #pumpQueued = false;
  #mutationsInFlight = 0;
  #activeMutationAuthorityFingerprint: string | null = null;
  #controlTail: Promise<void> = Promise.resolve();
  #originBySequence = new Map<number, string>();
  #subscriptionRevision = 0;
  #drainWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();

  constructor(options: SyncTenantSocketBridgeOptions) {
    assertVerifiedTenantSyncAuthority(options.authContext);
    this.#socket = options.socket;
    this.#plane = options.plane;
    this.#observability = options.observability ?? null;
    this.#authContext = freezeTenantSyncAuthContext(options.authContext);
    this.#snapshotTables = options.snapshotTables;
    this.#assertCurrentAuthoritySync = options.assertCurrentAuthoritySync;
    this.#assertCurrentReadAuthoritySync = options.assertCurrentReadAuthoritySync
      ?? options.assertCurrentAuthoritySync;
    this.#assertMutationAuthoritySync = options.assertMutationAuthoritySync;
    this.#tables = validateTenantSyncTableCatalog(options.plane.tables);
  }

  ownsTable(table: unknown): table is string {
    return typeof table === 'string' && Object.hasOwn(this.#tables, table);
  }

  ownsAnyTable(tables: unknown): boolean {
    return Array.isArray(tables) && tables.some((table) => this.ownsTable(table));
  }

  table(table: string): SyncTenantDataPlaneTable | null {
    return this.#tables[table] ?? null;
  }

  /** Stop tenant-plane fanout and release an actor slot no longer in use. */
  clearSubscription(): Promise<void> {
    const revision = ++this.#subscriptionRevision;
    this.#subscribedTables.clear();
    this.#baselineReady = false;
    const task = this.#controlTail.then(async () => {
      if (revision !== this.#subscriptionRevision) return;
      this.#subscribedTables.clear();
      this.#baselineReady = false;
      try {
        this.#assertCurrentDelivery(revision);
        const purge: SyncSnapshotMessage = {
          type: 'sync.snapshot',
          plane: 'tenant',
          tables: {},
          seq: this.#actorCursor,
          ...(this.#epoch === null ? {} : { epoch: this.#epoch }),
          scope: this.#socket.data.authorizationScope,
          reset: 'purge',
        };
        if (!sendSyncWire(this.#socket, purge)) return;
        await waitForSyncDrain(this.#socket);
        this.#assertCurrentDelivery(revision);
      } finally {
        if (revision === this.#subscriptionRevision) this.#detachBinding();
      }
    });
    const guarded = task.catch((error) => {
      if (error instanceof SyncTenantSubscriptionSupersededError) return;
      throw error;
    });
    this.#controlTail = guarded.catch(() => undefined);
    return guarded;
  }

  /** Actor cursor is intentionally not the socket's last delivered wire seq. */
  diagnostics(): Readonly<{
    actorCursor: number;
    lastDeliveredWireSeq: number;
    epoch: string | null;
    generation: number | null;
    bound: boolean;
  }> {
    return Object.freeze({
      actorCursor: this.#actorCursor,
      lastDeliveredWireSeq: this.#lastDeliveredWireSeq,
      epoch: this.#epoch,
      generation: this.#generation,
      bound: this.#binding !== null,
    });
  }

  /** Serialize subscribe handshakes so a late response cannot replace a newer one. */
  subscribe(message: SyncSubscribeMessage): Promise<void> {
    const revision = ++this.#subscriptionRevision;
    const task = this.#controlTail.then(() => this.#subscribe(message, revision));
    const guarded = task.catch((error) => {
      if (error instanceof SyncTenantSubscriptionSupersededError) return;
      if (isTenantSyncAuthorityFailure(error)) {
        this.dispose();
        return;
      }
      if (isTenantSyncDatabaseCapacityExhausted(error)) {
        this.#closeForTerminalDatabaseCapacity();
        return;
      }
      if (isTerminalTenantSyncSnapshotFailure(error)) {
        this.#closeForTerminalSnapshot(error);
        return;
      }
      this.#closeForResnapshot(
        isTenantSyncHistoryGap(error)
          ? 'Tenant Sync history unavailable'
          : 'Tenant Sync subscription failed',
      );
    });
    this.#controlTail = guarded;
    return guarded;
  }

  async loadRow(table: string, rowId: string): Promise<Row | null> {
    this.#assertUsable();
    if (!this.ownsTable(table)) return null;
    this.#assertCurrentReadAuthoritySync();
    const binding = await this.#ensureBinding();
    const result = await binding.client.get(table, rowId, {
      consistency: { mode: 'strong' },
    });
    this.#assertCurrentReadAuthoritySync();
    return result.value as Row | null;
  }

  /**
   * Commit and acknowledge under one per-socket gate. Wakeups may arrive while
   * the actor commits, but this socket first installs the origin mapping and
   * delivers the durable prefix through its commit before queuing the ack.
   */
  commit(input: SyncTenantMutationCommit): Promise<void> {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const run = async (): Promise<void> => {
      let committed = false;
      this.#mutationsInFlight += 1;
      try {
        this.#assertMutationBaseline();
        this.#activeMutationAuthorityFingerprint =
          input.authorityFingerprint ?? null;
        this.#assertCurrentAuthoritySync();
        if (input.authorityFingerprint) {
          this.#assertMutationAuthoritySync?.(input.authorityFingerprint);
        }
        const binding = await this.#ensureBinding();
        const operation = input.assertions?.length
          ? {
            type: 'batch' as const,
            idempotencyKey: input.idempotencyKey,
            assertions: input.assertions,
            mutations: [input.mutation],
          }
          : {
            type: 'mutate' as const,
            idempotencyKey: input.idempotencyKey,
            mutation: input.mutation,
          };
        const commitResult = await binding.trustedWriter.executeWrite(operation, {
          logicalReceiptFingerprint: input.logicalReceiptFingerprint,
        });
        committed = true;
        this.#assertCurrentAuthoritySync();
        if (input.authorityFingerprint) {
          this.#assertMutationAuthoritySync?.(input.authorityFingerprint);
        }
        const change = canonicalChangeFromCommit(commitResult, input.mutation);
        if (change.seq > this.#actorCursor) {
          this.#originBySequence.set(change.seq, this.#socket.data.connectionId);
          if (this.#baselineReady) {
            await this.#replayThrough(binding, change.seq);
          }
        }
        // `#replayThrough()` may await actor IO or outbound drain. Re-check
        // both the durable session authority and the exact mutation-policy
        // fingerprint in the continuation immediately before the canonical
        // acknowledgement crosses the wire.
        this.#assertCurrentAuthoritySync();
        if (input.authorityFingerprint) {
          this.#assertMutationAuthoritySync?.(input.authorityFingerprint);
        }
        input.acknowledge(change);
        resolve();
      } catch (error) {
        reject(committed ? tenantSyncMutationRecoveryError() : error);
      } finally {
        this.#activeMutationAuthorityFingerprint = null;
        this.#mutationsInFlight -= 1;
        this.#schedulePump();
      }
    };
    this.#controlTail = this.#controlTail.then(run, run).catch(() => undefined);
    return result;
  }

  /**
   * Resolve a durable logical receipt before any row pre-read. A hit is
   * reauthorized against its immutable previous-row envelope and acknowledged
   * under the same origin/replay gate as a new commit.
   */
  replayMutationReceipt(input: SyncTenantMutationReceiptReplay): Promise<boolean> {
    let resolve!: (hit: boolean) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<boolean>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const run = async (): Promise<void> => {
      this.#mutationsInFlight += 1;
      try {
        this.#assertMutationBaseline();
        this.#assertCurrentAuthoritySync();
        const binding = await this.#ensureBinding();
        const receipt = await binding.trustedWriter.findReceipt(
          input.idempotencyKey,
          input.logicalReceiptFingerprint,
        );
        this.#assertCurrentAuthoritySync();
        if (receipt.status === 'miss') {
          resolve(false);
          return;
        }
        let change: Change;
        try {
          change = canonicalChangeFromCommit(receipt.result);
          assertExpectedTenantReceiptChange(change, input.expected);
        } catch {
          throw tenantSyncMutationRecoveryError();
        }
        let authorized: boolean;
        try {
          authorized = await input.authorize(change);
        } catch {
          throw tenantSyncMutationRecoveryError();
        }
        if (!authorized) {
          throw tenantSyncAuthorityChangedError();
        }
        this.#assertCurrentAuthoritySync();
        if (change.seq > this.#actorCursor) {
          this.#originBySequence.set(change.seq, this.#socket.data.connectionId);
          if (this.#baselineReady) {
            try {
              await this.#replayThrough(binding, change.seq);
            } catch {
              throw tenantSyncMutationRecoveryError();
            }
          }
        }
        // Ordered replay can yield after receipt reauthorization. Fence the
        // final acknowledgement again so revoked authority cannot use that
        // continuation window to receive a row-bearing canonical result.
        this.#assertCurrentAuthoritySync();
        input.acknowledge(change);
        resolve(true);
      } catch (error) {
        reject(error);
      } finally {
        this.#mutationsInFlight -= 1;
        this.#schedulePump();
      }
    };
    this.#controlTail = this.#controlTail.then(run, run).catch(() => undefined);
    return result;
  }

  /** Continue a paused durable pull after Bun reports that queued bytes drained. */
  resume(): void {
    if (this.#socket.data.syncBackpressured) return;
    for (const waiter of this.#drainWaiters) waiter.resolve();
    this.#drainWaiters.clear();
    this.#schedulePump();
  }

  /** Preserve pending optimistic work and force a same-ref receipt recovery. */
  recoverUnacknowledgedMutation(): void {
    if (this.#disposed) return;
    this.#emit(OBS_CODES.SYNC_TENANT_MUTATION_RECOVERY_REQUIRED, {
      metadata: {
        plane: 'tenant-database',
        reason: 'mutation-recovery-required',
      },
    });
    try {
      this.#socket.close(1012, 'Tenant Sync mutation recovery required');
    } finally {
      this.dispose();
    }
  }

  /** Idempotently detach wakeups and release the actor lease. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    rejectSyncDrain(this.#socket);
    this.#detachBinding();
    this.#originBySequence.clear();
    const closed = new Error('Tenant Sync socket is closed');
    for (const waiter of this.#drainWaiters) waiter.reject(closed);
    this.#drainWaiters.clear();
  }

  async #subscribe(
    message: SyncSubscribeMessage,
    revision: number,
  ): Promise<void> {
    this.#assertUsable();
    if (revision !== this.#subscriptionRevision || !validTenantSyncSubscribe(message)) return;
    this.#baselineReady = false;
    this.#assertCurrentReadAuthoritySync();

    const requested = uniqueTenantSyncStrings(message.tables);
    const subscribed = requested.filter(
      (table) => this.ownsTable(table) && this.#socket.data.allowedTables.has(table),
    );
    this.#subscribedTables = new Set(subscribed);
    const snapshotSelection = uniqueTenantSyncStrings(message.snapshot ?? []).filter(
      (table) => subscribed.includes(table)
        && (!this.#snapshotTables || this.#snapshotTables.has(table)),
    );

    // A configured actor table is not itself authority to enter the tenant
    // database. Send an explicit purge without acquiring/pinning an actor when
    // none of the requested actor tables survived access resolution.
    if (subscribed.length === 0) {
      const sent = await this.#sendUnboundEmptySnapshot(revision);
      if (!sent) return;
      this.#assertCurrentDelivery(revision);
      this.#baselineReady = true;
      this.#detachBinding();
      return;
    }

    const binding = await this.#ensureBinding();
    if (revision !== this.#subscriptionRevision) return;
    const hasPriorCursor = message.epoch !== undefined || message.lastSeq > 0;
    const scopeMatches = typeof message.scope === 'string'
      && message.scope === this.#socket.data.authorizationScope;
    const scopeChanged = hasPriorCursor && !scopeMatches;

    if (subscribed.length > 0
      && !scopeChanged
      && message.epoch
      && message.lastSeq >= 0) {
      try {
        const catchup = await this.#sendCatchup(
          binding,
          message,
          subscribed,
          revision,
        );
        if (catchup === 'sent') {
          this.#assertCurrentDelivery(revision);
          this.#baselineReady = true;
          this.#schedulePump();
          return;
        }
        if (catchup === 'failed') return;
      } catch (error) {
        if (!isTenantSyncHistoryGap(error)) throw error;
      }
    }

    const sent = await this.#sendSnapshot(
      binding,
      snapshotSelection,
      scopeChanged ? 'purge' : 'preserve-pending',
      revision,
    );
    if (!sent) return;
    this.#assertCurrentDelivery(revision);
    this.#baselineReady = true;
    this.#schedulePump();
  }

  async #sendUnboundEmptySnapshot(revision: number): Promise<boolean> {
    this.#assertCurrentDelivery(revision);
    const message: SyncSnapshotMessage = {
      type: 'sync.snapshot',
      plane: 'tenant',
      tables: {},
      seq: 0,
      scope: this.#socket.data.authorizationScope,
      reset: 'purge',
    };
    if (!sendSyncWire(this.#socket, message)) return false;
    await waitForSyncDrain(this.#socket);
    this.#assertCurrentDelivery(revision);
    this.#acceptSnapshotCursor(0);
    this.#epoch = null;
    this.#generation = null;
    return true;
  }

  async #sendSnapshot(
    binding: SyncTenantDataPlaneBinding,
    selected: readonly string[],
    reset: NonNullable<SyncSnapshotMessage['reset']>,
    revision: number,
  ): Promise<boolean> {
    return sendTenantSnapshot({
      socket: this.#socket,
      binding,
      selected,
      reset,
      catalog: this.#tables,
      isCurrent: () => revision === this.#subscriptionRevision,
      assertCurrent: () => this.#assertCurrentDelivery(revision),
      acceptIdentity: (snapshot) => this.#acceptIdentity(snapshot),
      acceptCursor: (sequence) => this.#acceptSnapshotCursor(sequence),
      onCleanupFailure: () => this.#emitTenantSnapshotCleanupFailure(),
    });
  }

  #acceptSnapshotCursor(sequence: number): void {
    this.#actorCursor = sequence;
    this.#lastDeliveredWireSeq = sequence;
    this.#dropConsumedOrigins(sequence);
  }

  #assertCurrentDelivery(revision: number): undefined {
    if (revision !== this.#subscriptionRevision) {
      throw new SyncTenantSubscriptionSupersededError();
    }
    this.#assertCurrentReadAuthoritySync();
    return undefined;
  }

  async #sendCatchup(
    binding: SyncTenantDataPlaneBinding,
    message: SyncSubscribeMessage,
    subscribed: readonly string[],
    revision: number,
  ): Promise<'sent' | 'snapshot' | 'failed'> {
    let cursor = message.lastSeq;
    let head = message.lastSeq;
    let epoch = message.epoch;
    const changes: SyncCatchupMessage['changes'] = [];
    // Bound both work and memory. A larger replay safely falls back to the
    // actor's authoritative snapshot path.
    for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
      const replay = await binding.replay(cursor, DEFAULT_REPLAY_LIMIT);
      if (revision !== this.#subscriptionRevision) return 'failed';
      this.#assertCurrentReadAuthoritySync();
      if (replay.syncEpoch !== message.epoch) return 'snapshot';
      this.#acceptIdentity(replay);
      validateTenantReplayPage(replay, cursor);
      head = replay.sequence.seq;
      epoch = replay.syncEpoch;
      for (const change of replay.value.changes) {
        cursor = change.seq;
        if (!subscribed.includes(change.table)) continue;
        const projected = projectSyncChange(
          change as Change,
          this.#socket.data.resourceRowFilters.get(change.table),
          this.#socket.data.resourceRowProjectors?.get(change.table),
        );
        if (projected) changes.push({ ...projected, origin: '' });
      }
      const estimate = encoder.encode(JSON.stringify(changes)).byteLength;
      if (estimate > MAX_CATCHUP_WIRE_BYTES) return 'snapshot';
      if (replay.value.nextAfterSeq === null) break;
      if (pageIndex === 7) return 'snapshot';
    }
    const response: SyncCatchupMessage = {
      type: 'sync.catchup',
      plane: 'tenant',
      changes,
      seq: head,
      prevSeq: message.lastSeq,
      epoch,
      scope: this.#socket.data.authorizationScope,
    };
    if (encoder.encode(JSON.stringify(response)).byteLength > MAX_CATCHUP_WIRE_BYTES) {
      return 'snapshot';
    }
    this.#assertCurrentReadAuthoritySync();
    if (!sendSyncWire(this.#socket, response)) return 'failed';
    this.#actorCursor = head;
    this.#lastDeliveredWireSeq = head;
    this.#dropConsumedOrigins(head);
    return 'sent';
  }

  async #ensureBinding(): Promise<SyncTenantDataPlaneBinding> {
    this.#assertUsable();
    if (this.#binding) return this.#binding;
    if (this.#bindingTask) return await this.#bindingTask;

    const authority = (): undefined => {
      this.#assertCurrentAuthoritySync();
      if (this.#activeMutationAuthorityFingerprint) {
        this.#assertMutationAuthoritySync?.(
          this.#activeMutationAuthorityFingerprint,
        );
      }
      return undefined;
    };
    const readAuthority = (): undefined => {
      this.#assertCurrentReadAuthoritySync();
      if (this.#activeMutationAuthorityFingerprint) {
        this.#assertMutationAuthoritySync?.(
          this.#activeMutationAuthorityFingerprint,
        );
      }
      return undefined;
    };
    const bindingRevision = this.#bindingRevision;
    const task = this.#plane.bind(Object.freeze({
      authContext: this.#authContext,
      assertCurrentAuthoritySync: authority,
      assertCurrentReadAuthority: readAuthority,
    })).then((binding) => {
      let unsubscribe: (() => void) | null = null;
      try {
        if (this.#disposed || bindingRevision !== this.#bindingRevision) {
          throw new SyncTenantSubscriptionSupersededError();
        }
        validateTenantSyncBinding(binding);
        // Subscribe before publishing the binding. A coordinator invalidation
        // that happened before this continuation is detected by `released`;
        // once this synchronous listener install begins, JavaScript cannot
        // interleave another invalidation before the second state check.
        const installed = binding.onWakeup((wakeup) => this.#onWakeup(wakeup));
        if (typeof installed !== 'function') {
          throw new TypeError('Tenant Sync wakeup subscription is invalid');
        }
        unsubscribe = installed;
        if (this.#disposed
          || bindingRevision !== this.#bindingRevision
          || binding.released) {
          throw new Error('Tenant Sync binding is unavailable');
        }
        this.#binding = binding;
        this.#unsubscribe = unsubscribe;
        return binding;
      } catch (error) {
        try { unsubscribe?.(); } catch { /* Preserve the binding failure. */ }
        try { binding.release(); } catch { /* Already closed. */ }
        throw error;
      }
    });
    this.#bindingTask = task;
    try {
      return await task;
    } finally {
      if (this.#bindingTask === task) this.#bindingTask = null;
    }
  }

  #detachBinding(): void {
    this.#bindingRevision += 1;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    try { unsubscribe?.(); } catch { /* Preserve binding release. */ }
    const binding = this.#binding;
    this.#binding = null;
    if (binding) {
      try { binding.release(); } catch { /* Socket cleanup is best effort. */ }
    }
    // A pending bind observes the revision before it can publish itself and
    // releases the newly created capability in its own failure path.
    this.#bindingTask = null;
    this.#epoch = null;
    this.#generation = null;
    this.#actorCursor = 0;
    this.#lastDeliveredWireSeq = 0;
    this.#originBySequence.clear();
  }

  #onWakeup(wakeup: SyncTenantDataPlaneWakeup): void {
    if (this.#disposed) return;
    const binding = this.#binding;
    if (!binding || wakeup.databaseRef !== binding.databaseRef) {
      this.#closeForResnapshot('Tenant Sync binding changed');
      return;
    }
    if (wakeup.type === 'unavailable') {
      this.#closeForResnapshot('Tenant Sync database unavailable');
      return;
    }
    if (wakeup.type === 'reset') {
      this.#closeForResnapshot('Tenant Sync database reset');
      return;
    }
    if (this.#generation !== null && wakeup.generation !== this.#generation) {
      this.#closeForResnapshot('Tenant Sync generation changed');
      return;
    }
    if (this.#epoch !== null && wakeup.syncEpoch !== this.#epoch) {
      this.#closeForResnapshot('Tenant Sync epoch changed');
      return;
    }
    if (wakeup.throughSeq > this.#actorCursor) this.#schedulePump();
  }

  #schedulePump(): void {
    if (this.#disposed || !this.#baselineReady) return;
    this.#pumpQueued = true;
    if (this.#pumpTask) return;
    const task = Promise.resolve().then(() => this.#pump());
    this.#pumpTask = task;
    void task.catch((error) => {
      if (isTenantSyncHistoryGap(error)) {
        this.#closeForResnapshot('Tenant Sync history unavailable');
      } else {
        this.#closeForResnapshot('Tenant Sync replay failed');
      }
    }).finally(() => {
      if (this.#pumpTask === task) this.#pumpTask = null;
      if (this.#pumpQueued
        && !this.#disposed
        && !this.#socket.data.syncBackpressured
        && this.#mutationsInFlight === 0) this.#schedulePump();
    });
  }

  async #pump(): Promise<void> {
    if (this.#disposed
      || this.#socket.data.syncBackpressured
      || this.#mutationsInFlight > 0) return;
    this.#pumpQueued = false;
    const binding = await this.#ensureBinding();

    while (!this.#disposed
      && !this.#socket.data.syncBackpressured
      && this.#mutationsInFlight === 0) {
      this.#assertCurrentReadAuthoritySync();
      const replay = await binding.replay(this.#actorCursor, DEFAULT_REPLAY_LIMIT);
      this.#assertCurrentReadAuthoritySync();
      if (!this.#baselineReady) return;
      this.#acceptIdentity(replay);
      validateTenantReplayPage(replay, this.#actorCursor);

      for (const durable of replay.value.changes) {
        if (this.#disposed
          || this.#socket.data.syncBackpressured
          || this.#mutationsInFlight > 0) {
          this.#pumpQueued = true;
          return;
        }
        if (durable.seq !== this.#actorCursor + 1) {
          throw tenantHistoryGapError();
        }
        const delivered = this.#deliverDurable(durable, replay.syncEpoch, true);
        if (!delivered) return;
        this.#actorCursor = durable.seq;
        this.#originBySequence.delete(durable.seq);
      }

      if (replay.value.changes.length === 0) {
        if (replay.sequence.seq !== this.#actorCursor) throw tenantHistoryGapError();
        return;
      }
      if (replay.value.nextAfterSeq === null) {
        if (replay.sequence.seq !== this.#actorCursor) throw tenantHistoryGapError();
        return;
      }
    }
  }

  /** Deliver the exact durable prefix required before one mutation ack. */
  async #replayThrough(
    binding: SyncTenantDataPlaneBinding,
    targetSeq: number,
  ): Promise<void> {
    while (!this.#disposed && this.#actorCursor < targetSeq) {
      await this.#waitForDrain();
      this.#assertCurrentReadAuthoritySync();
      const replay = await binding.replay(this.#actorCursor, DEFAULT_REPLAY_LIMIT);
      this.#assertCurrentReadAuthoritySync();
      this.#acceptIdentity(replay);
      validateTenantReplayPage(replay, this.#actorCursor);
      if (replay.value.changes.length === 0) throw tenantHistoryGapError();
      for (const durable of replay.value.changes) {
        if (durable.seq > targetSeq) return;
        if (durable.seq !== this.#actorCursor + 1) throw tenantHistoryGapError();
        await this.#waitForDrain();
        this.#assertCurrentReadAuthoritySync();
        // The origin change is deliberately delivered at its ordered point.
        // Its optimistic mutation remains pending until the following ack.
        if (!this.#deliverDurable(durable, replay.syncEpoch, false)) {
          throw new Error('Tenant Sync ordered mutation delivery failed');
        }
        this.#actorCursor = durable.seq;
        this.#originBySequence.delete(durable.seq);
        if (this.#actorCursor === targetSeq) return;
      }
    }
    if (!this.#disposed && this.#actorCursor < targetSeq) throw tenantHistoryGapError();
  }

  #deliverDurable(
    durable: SyncTenantDataPlaneReplayChange,
    epoch: string,
    suppressOwnOrigin: boolean,
  ): boolean {
    const origin = this.#originBySequence.get(durable.seq) ?? '';
    const ownOrigin = origin === this.#socket.data.connectionId;
    if ((suppressOwnOrigin && ownOrigin)
      || durable.table.startsWith('_')
      || !this.#subscribedTables.has(durable.table)
      || !this.#socket.data.allowedTables.has(durable.table)) return true;
    const projected = projectSyncChange(
      durable as Change,
      this.#socket.data.resourceRowFilters.get(durable.table),
      this.#socket.data.resourceRowProjectors?.get(durable.table),
    );
    if (!projected) return true;
    // Resource projectors are extension code. Revalidate after they return so
    // a synchronous authority mutation cannot precede this wire frame.
    this.#assertCurrentReadAuthoritySync();
    const delivered = sendSyncWire(this.#socket, {
      type: 'sync.change',
      plane: 'tenant',
      ...projected,
      prevSeq: this.#lastDeliveredWireSeq,
      epoch,
      scope: this.#socket.data.authorizationScope,
      origin,
    });
    if (delivered) this.#lastDeliveredWireSeq = durable.seq;
    return delivered;
  }

  #waitForDrain(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('Tenant Sync socket is closed'));
    if (!this.#socket.data.syncBackpressured) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          this.#drainWaiters.delete(waiter);
          resolve();
        },
        reject: (error: Error) => {
          this.#drainWaiters.delete(waiter);
          reject(error);
        },
      };
      this.#drainWaiters.add(waiter);
    });
  }

  #acceptIdentity(value: {
    databaseRef: string;
    generation: number;
    syncEpoch: string;
  }): void {
    const binding = this.#binding;
    if (!binding || value.databaseRef !== binding.databaseRef) {
      throw new Error('Tenant Sync database binding changed');
    }
    if (this.#generation !== null && value.generation !== this.#generation) {
      throw tenantHistoryGapError();
    }
    if (this.#epoch !== null && value.syncEpoch !== this.#epoch) {
      throw tenantHistoryGapError();
    }
    this.#generation = value.generation;
    this.#epoch = value.syncEpoch;
  }

  #dropConsumedOrigins(throughSeq: number): void {
    for (const seq of this.#originBySequence.keys()) {
      if (seq <= throughSeq) this.#originBySequence.delete(seq);
    }
  }

  #closeForResnapshot(reason: string): void {
    if (this.#disposed) return;
    this.#emit(OBS_CODES.SYNC_TENANT_RESNAPSHOT_REQUIRED, {
      metadata: { plane: 'tenant-database', reason },
    });
    try { this.#socket.close(1012, reason); } finally { this.dispose(); }
  }

  #closeForTerminalSnapshot(error: unknown): void {
    if (this.#disposed) return;
    const budgetFailure = error instanceof SyncTenantSnapshotBudgetError;
    this.#emit(
      budgetFailure
        ? OBS_CODES.SYNC_TENANT_SNAPSHOT_BUDGET_REJECTED
        : OBS_CODES.SYNC_SNAPSHOT_TRANSPORT_REJECTED,
      {
        metadata: {
          plane: 'tenant-database',
          ...(budgetFailure ? { reason: error.reason } : {}),
        },
      },
    );
    try {
      this.#socket.close(
        SYNC_TERMINAL_DATA_CLOSE_CODE,
        budgetFailure
          ? 'Tenant Sync snapshot exceeded bounded work'
          : 'Tenant Sync snapshot cannot fit the transport contract',
      );
    } finally {
      this.dispose();
    }
  }

  #closeForTerminalDatabaseCapacity(): void {
    if (this.#disposed) return;
    try {
      this.#socket.close(
        SYNC_TERMINAL_DATA_CLOSE_CODE,
        'Tenant Sync database capacity is exhausted',
      );
    } finally {
      this.dispose();
    }
  }

  /** Closed producer schema: no caught value or snapshot identity is accepted. */
  #emitTenantSnapshotCleanupFailure(): void {
    this.#emit(OBS_CODES.SYNC_TENANT_SNAPSHOT_CLEANUP_FAILED, {
      metadata: Object.freeze({
        plane: 'tenant-database',
        reason: 'snapshot-cleanup-failed',
      }),
    });
  }

  #emit(
    definition: PlatformCodeDefinition,
    options: PlatformCodeEmitOptions = {},
  ): void {
    if (this.#observability) {
      emitPlatformCodeTo(this.#observability, definition, options);
      return;
    }
    emitPlatformCode(definition, options);
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error('Tenant Sync socket is closed');
  }

  #assertMutationBaseline(): void {
    this.#assertUsable();
    if (!this.#baselineReady) {
      throw new Error('Tenant Sync mutation requires an accepted tenant baseline');
    }
  }
}
