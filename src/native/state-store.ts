/** Observable native auth state with access tokens confined to process memory. */

import type { NativeAuthState, NativeAuthStateListener } from './client-types';
import type { NativeAuthError } from './errors';
import type { NativeIdTokenClaims, NativeTokenSet } from './oidc-types';

export class NativeAuthStateStore {
  private snapshot: NativeAuthState = freezeState('uninitialized', null, null, null);
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private readonly listeners = new Set<NativeAuthStateListener>();

  constructor(private readonly now: () => number) {}

  get state(): NativeAuthState {
    return this.snapshot;
  }

  subscribe(listener: NativeAuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setAuthorizing(): void {
    this.clearAccessToken();
    this.publish(freezeState('authorizing', this.snapshot.identity, this.snapshot.activeTenant ?? null, null));
  }

  setAuthenticated(tokens: NativeTokenSet, identity: NativeIdTokenClaims): void {
    this.accessToken = tokens.accessToken;
    this.accessExpiresAt = this.now() + tokens.expiresIn * 1000;
    this.publish(freezeState(
      'authenticated', cloneIdentity(identity), tokens.activeTenant ?? null, null,
    ));
  }

  setAnonymous(): void {
    this.clearAccessToken();
    this.publish(freezeState('anonymous', null, null, null));
  }

  setError(error: NativeAuthError): void {
    this.clearAccessToken();
    this.publish(freezeState('error', null, null, {
      code: error.code,
      message: error.message,
      status: error.status,
    }));
  }

  usableAccessToken(minimumValiditySeconds = 30): string | null {
    return this.accessExpiresAt > this.now() + minimumValiditySeconds * 1000
      ? this.accessToken
      : null;
  }

  currentIdentity(): NativeIdTokenClaims | null {
    return this.snapshot.identity;
  }

  private clearAccessToken(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
  }

  private publish(next: NativeAuthState): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // User observers must never roll back a completed credential transition.
      }
    }
  }
}

function freezeState(
  status: NativeAuthState['status'],
  identity: NativeIdTokenClaims | null,
  activeTenant: import('./client-types').NativeTenantSummary | null,
  error: NativeAuthState['error'],
): NativeAuthState {
  return Object.freeze({
    status,
    identity,
    activeTenant: activeTenant ? Object.freeze({ ...activeTenant }) : null,
    error: error ? Object.freeze(error) : null,
  });
}

function cloneIdentity(identity: NativeIdTokenClaims): NativeIdTokenClaims {
  const aud = Array.isArray(identity.aud) ? [...identity.aud] : identity.aud;
  return Object.freeze({ ...identity, aud });
}
