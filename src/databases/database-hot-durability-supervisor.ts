/**
 * Parent-side watchdog for periodic hot-database durability signals.
 *
 * Executor callbacks are synchronous and untrusted. This supervisor validates
 * their exact closed shape, maintains one snapshot/dirty deadline per writer,
 * emits only closed app-local events, and requests retirement at most once for
 * a failed generation.
 */

import type { DatabaseActorRole } from './database-actor-protocol';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import {
  isExactDatabaseExecutorEvent,
  periodicDurabilityDeadlineRemaining,
} from './database-coordinator-runtime';
import { DatabaseError } from './database-error';
import type { DatabaseExecutor, DatabaseExecutorEvent } from './database-executor';
import type { DatabaseObservability } from './database-observability';

interface DatabaseHotDurabilitySupervisorOptions {
  readonly now: () => number;
  readonly observability: DatabaseObservability | null;
  readonly isObservedEntryCurrent: (
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
  ) => boolean;
  readonly isReadyWriterCurrent: (
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
  ) => boolean;
  readonly onFatal: (
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
  ) => void;
}

export class DatabaseHotDurabilitySupervisor {
  private readonly snapshotWatchdogs = new WeakMap<
    DatabaseExecutor,
    ReturnType<typeof setTimeout>
  >();
  private readonly durabilityDeadlines = new WeakMap<
    DatabaseExecutor,
    ReturnType<typeof setTimeout>
  >();
  private readonly observedFailures = new WeakSet<DatabaseExecutor>();

  constructor(private readonly options: DatabaseHotDurabilitySupervisorOptions) {}

  observe(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
    event: DatabaseExecutorEvent,
  ): void {
    if (!isExactDatabaseExecutorEvent(event)
      || !this.options.isObservedEntryCurrent(entry, executor, role)
      || role !== 'writer'
      || entry.placement.mode !== 'hot'
      || entry.placement.durability !== 'periodic') return;

    const context = {
      databaseRef: entry.databaseRef,
      placement: 'hot' as const,
      durability: 'periodic' as const,
      role: 'writer' as const,
      slot: entry.slot,
      generation: executor.diagnostics().generation,
    };
    switch (event.type) {
      case 'hot-periodic-snapshot-started':
        this.emit({ type: 'hot-snapshot-started', ...context });
        this.armSnapshotWatchdog(entry, executor);
        return;
      case 'hot-periodic-snapshot-finished':
        this.clearSnapshotWatchdog(executor);
        this.emit({ type: 'hot-snapshot-finished', ...context });
        return;
      case 'hot-periodic-durability-dirty':
        this.emit({ type: 'hot-durability-dirty', ...context });
        this.armDurabilityDeadline(entry, executor);
        return;
      case 'hot-periodic-durability-clean':
        this.clearDurabilityDeadline(executor);
        this.emit({ type: 'hot-durability-clean', ...context });
        return;
      case 'hot-periodic-durability-failed':
        this.fail(entry, executor);
        return;
    }
  }

  clear(executor: DatabaseExecutor | null): void {
    this.clearSnapshotWatchdog(executor);
    this.clearDurabilityDeadline(executor);
  }

  private armSnapshotWatchdog(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
  ): void {
    this.clearSnapshotWatchdog(executor);
    const timeoutMs = entry.placement.mode === 'hot'
      && entry.placement.durability === 'periodic'
      ? entry.placement.snapshotTimeoutMs
      : undefined;
    if (timeoutMs === undefined) {
      this.fail(entry, executor);
      return;
    }
    const timer = setTimeout(() => {
      if (this.snapshotWatchdogs.get(executor) !== timer) return;
      this.snapshotWatchdogs.delete(executor);
      this.fail(entry, executor);
    }, timeoutMs);
    timer.unref?.();
    this.snapshotWatchdogs.set(executor, timer);
  }

  private clearSnapshotWatchdog(executor: DatabaseExecutor | null): void {
    if (!executor) return;
    const timer = this.snapshotWatchdogs.get(executor);
    if (!timer) return;
    clearTimeout(timer);
    this.snapshotWatchdogs.delete(executor);
  }

  private armDurabilityDeadline(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
  ): void {
    // Never extend the oldest uncovered commit's deadline with later writes.
    if (this.durabilityDeadlines.has(executor)) return;
    const intervalMs = entry.placement.mode === 'hot'
      && entry.placement.durability === 'periodic'
      ? entry.placement.snapshotIntervalMs
      : undefined;
    if (intervalMs === undefined) {
      this.fail(entry, executor);
      return;
    }
    const startedAt = this.options.now();
    const schedule = (delayMs: number): void => {
      const timer = setTimeout(() => {
        if (this.durabilityDeadlines.get(executor) !== timer) return;
        const remainingMs = periodicDurabilityDeadlineRemaining(
          startedAt,
          this.options.now(),
          intervalMs,
        );
        if (remainingMs > 0) {
          schedule(remainingMs);
          return;
        }
        this.durabilityDeadlines.delete(executor);
        this.fail(entry, executor);
      }, delayMs);
      timer.unref?.();
      this.durabilityDeadlines.set(executor, timer);
    };
    schedule(intervalMs);
  }

  private clearDurabilityDeadline(executor: DatabaseExecutor | null): void {
    if (!executor) return;
    const timer = this.durabilityDeadlines.get(executor);
    if (!timer) return;
    clearTimeout(timer);
    this.durabilityDeadlines.delete(executor);
  }

  private fail(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
  ): void {
    this.clear(executor);
    if (this.observedFailures.has(executor)
      || !this.options.isReadyWriterCurrent(entry, executor)) return;
    this.observedFailures.add(executor);
    const error = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Hot database durability failed.',
      { retryable: false, outcome: 'unknown' },
    );
    this.emit({
      type: 'hot-durability-failed',
      databaseRef: entry.databaseRef,
      placement: 'hot',
      durability: 'periodic',
      role: 'writer',
      slot: entry.slot,
      generation: executor.diagnostics().generation,
      error,
    });
    queueMicrotask(() => {
      if (!this.options.isReadyWriterCurrent(entry, executor)) return;
      this.options.onFatal(entry, executor, error);
    });
  }

  private emit(event: Parameters<DatabaseObservability['emit']>[0]): void {
    try {
      this.options.observability?.emit(event);
    } catch {
      // Telemetry cannot change actor durability or retirement behavior.
    }
  }
}
