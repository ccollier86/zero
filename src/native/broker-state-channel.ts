/** Monotonic snapshots prevent stale IPC messages from rolling auth state back. */

import { cloneNativeAuthState } from './broker-state';
import type { NativeAuthBrokerSnapshot, NativeAuthBrokerStateListener } from './broker-types';
import type { NativeAuthClient } from './client-types';

export interface NativeAuthBrokerStateChannel {
  snapshot(): NativeAuthBrokerSnapshot;
  subscribe(listener: NativeAuthBrokerStateListener): () => void;
}

export function createNativeAuthBrokerStateChannel(
  client: NativeAuthClient,
): NativeAuthBrokerStateChannel {
  let revision = 0;
  const listeners = new Set<NativeAuthBrokerStateListener>();
  client.subscribe((state) => {
    revision += 1;
    const next = Object.freeze({ revision, state: cloneNativeAuthState(state) });
    for (const listener of listeners) safelyPublish(listener, next);
  });
  const snapshot = () => Object.freeze({
    revision,
    state: cloneNativeAuthState(client.state),
  });
  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      safelyPublish(listener, snapshot());
      return () => listeners.delete(listener);
    },
  };
}

function safelyPublish(
  listener: NativeAuthBrokerStateListener,
  snapshot: NativeAuthBrokerSnapshot,
): void {
  try { listener(snapshot); } catch {}
}
