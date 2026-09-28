/** Applies ordered broker snapshots and protects the configured issuer boundary. */

import { cloneNativeAuthState, sameNativeAuthState } from './broker-state';
import type { NativeAuthBrokerSnapshot } from './broker-types';
import type { NativeAuthState, NativeAuthStateListener } from './client-types';
import { NativeAuthError } from './errors';

export class NativeAuthBrokerClientState {
  private snapshotValue = cloneNativeAuthState({
    status: 'uninitialized', identity: null, activeTenant: null, error: null,
  });
  private revisionValue = -1;
  private issuerMismatch = false;
  private readonly listeners = new Set<NativeAuthStateListener>();

  constructor(private readonly issuer: string) {}

  get snapshot(): NativeAuthState { return this.snapshotValue; }

  subscribe(listener: NativeAuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(update: NativeAuthBrokerSnapshot): void {
    if (!Number.isSafeInteger(update.revision) || update.revision < 0
      || update.revision <= this.revisionValue) return;
    this.revisionValue = update.revision;
    const received = cloneNativeAuthState(update.state);
    this.issuerMismatch = received.status === 'authenticated'
      && received.identity?.iss !== this.issuer;
    const next = this.issuerMismatch ? cloneNativeAuthState({
      status: 'error',
      identity: null,
      activeTenant: null,
      error: {
        code: 'NATIVE_BROKER_ISSUER_MISMATCH',
        message: 'The auth broker issuer does not match serverUrl.',
      },
    }) : received;
    if (sameNativeAuthState(this.snapshotValue, next)) return;
    this.snapshotValue = next;
    for (const listener of this.listeners) {
      try { listener(this.snapshotValue); } catch {}
    }
  }

  acceptsAccessToken(revision: number): boolean {
    if (this.issuerMismatch) {
      throw new NativeAuthError(
        this.snapshotValue.error?.message ?? 'The auth broker issuer does not match serverUrl.',
        'NATIVE_BROKER_ISSUER_MISMATCH',
      );
    }
    return revision === this.revisionValue
      && this.snapshotValue.status === 'authenticated';
  }

  dispose(): void { this.listeners.clear(); }
}
