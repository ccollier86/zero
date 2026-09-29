/**
 * Durable external-change polling and ordered replica delivery for ReactiveDB.
 *
 * The poller owns cursor advancement, retry/gap semantics, and invalidation.
 * The ReactiveDB facade supplies only its log reader and local delivery hooks.
 */

import { deserializeChangeRow } from './reactive-db-change-codec';
import type { ChangeLogReadSnapshot } from './reactive-db-change-log';
import type {
  Change,
  ChangeDeliveryMetadata,
  SyncHistoryGap,
} from './types';
import { isReactiveDBPromiseLike } from './reactive-db-synchronous-boundary';

/** Options for durable change fanout between ReactiveDB file connections. */
export interface ExternalChangePollingOptions {
  /** Positive safe-integer poll cadence in milliseconds. Values below 10ms are clamped. */
  intervalMs?: number;
  /**
   * Called when retention/corruption makes incremental delivery impossible.
   * If omitted or if it throws, the dispatcher permanently invalidates this
   * runtime rather than silently advancing past undelivered history.
   */
  onGap?: (gap: SyncHistoryGap) => void;
  /**
   * Called once when the durable log/state is incompatible or corrupt.
   * The dispatcher stops after this callback; connected transports must
   * invalidate their clients rather than continue from an untrusted cursor.
   */
  onInvalid?: (error: unknown) => void;
  /** Called for a transient poll failure. The cursor is retained for retry. */
  onError?: (error: unknown) => void;
}

export interface ExternalChangeDispatcher {
  drain: () => void;
  stop: () => void;
}

interface ExternalChangePollerHost {
  writerEpoch: string;
  assertUsable: () => void;
  currentState: () => { seq: number; prune_through: number };
  readSnapshot: (afterSeq: number) => ChangeLogReadSnapshot;
  emitChange: (change: Change, delivery: ChangeDeliveryMetadata) => void;
  isDisposed: () => boolean;
  invalidate: () => void;
  clearLocalOriginsThrough: (sequence: number) => void;
  clearAllLocalOrigins: () => void;
  onStopped: (dispatcher: ExternalChangeDispatcher) => void;
}

export function createExternalChangeDispatcher(
  options: ExternalChangePollingOptions,
  host: ExternalChangePollerHost,
): ExternalChangeDispatcher {
  const requestedInterval = options.intervalMs ?? 250;
  if (!Number.isSafeInteger(requestedInterval) || requestedInterval < 1) {
    throw new Error(
      'ReactiveDB replica polling intervalMs must be a positive safe integer',
    );
  }
  const intervalMs = Math.max(10, requestedInterval);
  host.assertUsable();
  const initialState = host.currentState();
  let cursor = initialState.seq;
  let lastObservedPruneThrough = initialState.prune_through;
  let draining = false;
  let drainQueued = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const notifyError = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // An observability callback cannot stop the durable dispatcher.
    }
  };

  const stopTimer = () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const haltInvalid = () => {
    stopTimer();
    // Deliberately retain the facade's dispatcher latch. Local commits must
    // not fall back to direct delivery after the durable cursor is invalid.
  };

  const notifyInvalid = (error: unknown) => {
    host.invalidate();
    host.clearAllLocalOrigins();
    try {
      options.onInvalid?.(error);
    } catch (callbackError) {
      notifyError(callbackError);
    } finally {
      haltInvalid();
    }
  };

  const notifyGap = (gap: SyncHistoryGap): boolean => {
    if (!options.onGap) {
      notifyInvalid(new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: replica history gap was not handled',
      ));
      return false;
    }
    try {
      const handler = options.onGap as (value: SyncHistoryGap) => unknown;
      const outcome = handler.call(options, gap);
      if (isReactiveDBPromiseLike(outcome)) {
        void Promise.resolve(outcome).catch(() => {});
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: replica history gap handler must be synchronous',
        );
      }
      return true;
    } catch (error) {
      notifyError(error);
      notifyInvalid(new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: replica history gap handler failed',
      ));
      return false;
    }
  };

  const drainOnce = () => {
    const snapshot = host.readSnapshot(cursor);
    const currentSeq = snapshot.state.seq;
    if (currentSeq < cursor) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable sequence regressed behind replica cursor',
      );
    }
    if (snapshot.state.prune_through < lastObservedPruneThrough) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable prune watermark regressed',
      );
    }
    lastObservedPruneThrough = snapshot.state.prune_through;
    if (currentSeq === cursor && snapshot.contiguous) return;

    if (!snapshot.contiguous) {
      const afterSeq = cursor;
      if (notifyGap({
        kind: cursor < snapshot.state.prune_through ? 'retention' : 'continuity',
        afterSeq,
        oldestSeq: snapshot.oldestSeq,
        currentSeq,
      })) {
        host.clearLocalOriginsThrough(currentSeq);
        cursor = currentSeq;
      }
      return;
    }

    const decoded: Array<{
      change: Change;
      delivery: ChangeDeliveryMetadata;
    }> = [];
    for (const row of snapshot.rows) {
      try {
        // Decode the complete contiguous batch before advancing the cursor or
        // notifying a listener. Corrupt JSON requires an authoritative
        // reconnect instead of becoming a silently lost row.
        decoded.push({
          change: deserializeChangeRow(row),
          delivery: { source: row.origin === host.writerEpoch ? 'local' : 'external' },
        });
      } catch (error) {
        const afterSeq = cursor;
        notifyError(error);
        if (notifyGap({
          kind: 'format',
          afterSeq,
          oldestSeq: snapshot.oldestSeq,
          currentSeq,
        })) {
          host.clearLocalOriginsThrough(currentSeq);
          cursor = currentSeq;
        }
        return;
      }
    }

    for (const entry of decoded) {
      cursor = entry.change.seq;
      host.emitChange(entry.change, entry.delivery);
    }
  };

  const drain = () => {
    if (stopped || host.isDisposed()) return;
    if (draining) {
      drainQueued = true;
      return;
    }
    draining = true;
    try {
      do {
        drainQueued = false;
        drainOnce();
      } while (drainQueued && !stopped && !host.isDisposed());
    } catch (error) {
      if (isTransientChangeLogReadError(error)) notifyError(error);
      else notifyInvalid(error);
    } finally {
      draining = false;
    }
  };

  let dispatcher!: ExternalChangeDispatcher;
  const stop = () => {
    stopTimer();
    host.onStopped(dispatcher);
  };
  dispatcher = { drain, stop };

  timer = setInterval(drain, intervalMs);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
  return dispatcher;
}

function isTransientChangeLogReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errno?: unknown };
  return sqliteError.code === 'SQLITE_BUSY'
    || (typeof sqliteError.code === 'string' && sqliteError.code.startsWith('SQLITE_BUSY_'))
    || sqliteError.code === 'SQLITE_LOCKED'
    || (typeof sqliteError.code === 'string' && sqliteError.code.startsWith('SQLITE_LOCKED_'))
    || sqliteError.errno === 5
    || sqliteError.errno === 6;
}
