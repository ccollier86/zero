/** Mutable state owned by one composed Sync plugin instance. */

import type { EphemeralChannel } from './ephemeral-channel';
import type { EphemeralStateManager } from './ephemeral-manager';
import type { ReactiveDB } from './reactive-db';
import type { StateManager } from './state-manager';
import type { SyncMutationOriginContext } from './message-handler';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';

export type SyncPlatformCodeReporter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => void;

export interface SyncPluginRuntimeState {
  db: ReactiveDB;
  stateManager: StateManager | null;
  ephemeralManager: EphemeralStateManager | null;
  ephemeralChannel: EphemeralChannel | null;
  mutationOrigin: SyncMutationOriginContext;
  /** Latched after a non-retryable durable log/read failure. */
  replicaLogInvalid: boolean;
}

export function createSyncPluginRuntimeState(
  db: ReactiveDB,
): SyncPluginRuntimeState {
  return {
    db,
    stateManager: null,
    ephemeralManager: null,
    ephemeralChannel: null,
    mutationOrigin: { current: null },
    replicaLogInvalid: false,
  };
}
