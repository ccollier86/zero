/**
 * subprocess-database-telemetry-state.ts
 *
 * Validates ordered, payload-free hot-durability telemetry transitions. The
 * executor remains responsible for emitting events and applying fatal policy.
 */

import type {
  DatabaseExecutorEvent,
  DatabaseExecutorState,
} from './database-executor';
import type { DatabaseExecutorTelemetryMessage } from './subprocess-database-protocol';

export type DatabaseExecutorTelemetryTransition =
  | {
      readonly kind: 'event';
      readonly type: DatabaseExecutorEvent['type'];
    }
  | { readonly kind: 'fatal' };

/** State machine for one executor generation's hot-durability signals. */
export class SubprocessDatabaseTelemetryState {
  private snapshotActive = false;
  private durabilityDirty = false;

  accept(
    signal: DatabaseExecutorTelemetryMessage['signal'],
    executorState: DatabaseExecutorState,
  ): DatabaseExecutorTelemetryTransition | null {
    switch (signal) {
      case 'hot-periodic-snapshot-started':
        if (!allowsActiveWork(executorState) || this.snapshotActive) return null;
        this.snapshotActive = true;
        return { kind: 'event', type: signal };
      case 'hot-periodic-snapshot-finished':
        if (!allowsCompletion(executorState) || !this.snapshotActive) return null;
        this.snapshotActive = false;
        return { kind: 'event', type: signal };
      case 'hot-periodic-durability-dirty':
        if (!allowsActiveWork(executorState) || this.durabilityDirty) return null;
        this.durabilityDirty = true;
        return { kind: 'event', type: signal };
      case 'hot-periodic-durability-clean':
        if (!allowsCompletion(executorState) || !this.durabilityDirty) return null;
        this.durabilityDirty = false;
        return { kind: 'event', type: signal };
      case 'hot-periodic-durability-failed':
        if (!allowsCompletion(executorState)) return null;
        this.snapshotActive = false;
        this.durabilityDirty = false;
        return { kind: 'fatal' };
    }
  }
}

function allowsActiveWork(state: DatabaseExecutorState): boolean {
  return state === 'ready' || state === 'draining';
}

function allowsCompletion(state: DatabaseExecutorState): boolean {
  return state === 'ready' || state === 'draining' || state === 'closing';
}
