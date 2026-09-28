/** Native session restoration, persistence, and serialized refresh rotation. */

import type { NativeStoredSession, NativeTokenSet } from './oidc-types';
import { isSupersededOperation } from './lifecycle';
import { NativeAuthError, toNativeAuthError } from './errors';
import { commitNativeSession, discardNativeSession } from './session-commit';
import { storedSessionMatchesClient, type NativeSessionContext } from './session-context';
import { performNativeSessionRefresh } from './session-refresh';
import { createOperationSignal, raceWithSignal } from './abort';
import { revokeNativeRefreshTokenBestEffort } from './best-effort-revocation';
import {
  listNativeTenants,
  switchNativeTenant,
} from './token-endpoint';
import type { NativeTenantListResult } from './client-types';

export class NativeSessionManager {
  private stored: NativeStoredSession | null = null;
  private refreshing: { generation: number; promise: Promise<string | null> } | null = null;
  private switching: { tenantId: string; promise: Promise<void> } | null = null;
  private listing: Promise<NativeTenantListResult> | null = null;
  private credentialOperationTail: Promise<void> = Promise.resolve();
  constructor(private readonly input: NativeSessionContext) {}
  async initialize(): Promise<void> {
    const generation = this.input.lifecycle.capture();
    const stored = await this.input.vault.loadSession();
    if (!this.input.lifecycle.isCurrent(generation)) return;
    if (!stored) return this.input.state.setAnonymous();
    if (!storedSessionMatchesClient(stored, this.input.issuer, this.input.clientId)) {
      await this.input.lifecycle.commit(async () => {
        if (!this.input.lifecycle.isCurrent(generation)) return;
        await this.input.vault.clearSession();
        this.input.state.setAnonymous();
      });
      return;
    }
    this.stored = stored;
    try {
      await this.refresh(true, generation);
    } catch (error) {
      if (!isSupersededOperation(error)) throw error;
    }
  }
  async establish(
    tokens: NativeTokenSet,
    identity: NativeStoredSession['identity'],
    generation: number,
  ): Promise<void> {
    await commitNativeSession(this.commitInput(), tokens, identity, generation);
  }
  async establishAuthorization(
    tokens: NativeTokenSet,
    identity: NativeStoredSession['identity'],
    generation: number,
  ): Promise<void> {
    await commitNativeSession(this.commitInput(), tokens, identity, generation, true);
  }
  async accessToken(forceRefresh = false): Promise<string | null> {
    if (!forceRefresh) {
      const current = this.input.state.usableAccessToken();
      if (current) return current;
    }
    return this.refresh(true);
  }

  refreshAfterUnauthorized(rejectedToken: string): Promise<string | null> {
    const current = this.input.state.usableAccessToken(0);
    return current && current !== rejectedToken
      ? Promise.resolve(current)
      : this.refresh(true);
  }
  refresh(force = false, generation = this.input.lifecycle.capture()): Promise<string | null> {
    if (this.switching) {
      return this.switching.promise.then(() => this.input.state.usableAccessToken(0));
    }
    if (!force) {
      const current = this.input.state.usableAccessToken();
      if (current) return Promise.resolve(current);
    }
    if (!this.stored) return Promise.resolve(null);
    if (!this.refreshing || this.refreshing.generation !== generation) {
      const promise = this.runCredentialOperation(
        () => this.performRefresh(generation),
      ).finally(() => {
        if (this.refreshing?.promise === promise) this.refreshing = null;
      });
      this.refreshing = { generation, promise };
    }
    return this.refreshing.promise;
  }
  async clearLocal(): Promise<void> {
    this.stored = null;
    await this.input.vault.clearSession();
  }
  listTenants(): Promise<NativeTenantListResult> {
    if (this.listing) return this.listing;
    const promise = this.runCredentialOperation(
      () => this.performTenantList(),
    ).finally(() => {
      if (this.listing === promise) this.listing = null;
    });
    this.listing = promise;
    return promise;
  }

  private async performTenantList(): Promise<NativeTenantListResult> {
    const current = this.stored;
    if (!current) throw sessionRequired();
    const bounded = createOperationSignal(
      undefined, this.input.networkTimeoutMs, 'Tenant list request timed out.',
    );
    try {
      return await raceWithSignal(listNativeTenants(
        this.input,
        current.refreshToken,
        bounded.signal,
      ), bounded.signal);
    } finally {
      bounded.dispose();
    }
  }

  switchTenant(tenantId: string): Promise<void> {
    const normalized = tenantId.trim();
    if (!normalized || normalized !== tenantId || normalized.length > 200) {
      return Promise.reject(new NativeAuthError(
        'tenantId is malformed.', 'NATIVE_TENANT_ID_INVALID',
      ));
    }
    if (this.switching) {
      if (this.switching.tenantId === normalized) return this.switching.promise;
      return Promise.reject(new NativeAuthError(
        'Another tenant switch is already in progress.',
        'NATIVE_TENANT_SWITCH_IN_PROGRESS',
      ));
    }
    const promise = this.runCredentialOperation(
      () => this.performTenantSwitch(normalized),
    ).finally(() => {
      if (this.switching?.promise === promise) this.switching = null;
    });
    this.switching = { tenantId: normalized, promise };
    return promise;
  }

  private async performTenantSwitch(tenantId: string): Promise<void> {
    const previous = this.stored;
    if (!previous) throw sessionRequired();
    const generation = this.input.lifecycle.capture();
    this.input.state.setAuthorizing();
    let tokens: NativeTokenSet | null = null;
    try {
      const bounded = createOperationSignal(
        undefined, this.input.networkTimeoutMs, 'Tenant switch request timed out.',
      );
      let identity: NativeStoredSession['identity'];
      try {
        tokens = await raceWithSignal(switchNativeTenant(
          this.input,
          previous.refreshToken,
          tenantId,
          bounded.signal,
        ), bounded.signal);
        if (!tokens.refreshToken || !tokens.idToken || !tokens.activeTenant) {
          throw new NativeAuthError(
            'Tenant switch response omitted session data.',
            'OIDC_TENANT_RESPONSE_INVALID',
          );
        }
        identity = await raceWithSignal(this.input.validator.validate({
          token: tokens.idToken,
          accessToken: tokens.accessToken,
          expectedSubject: previous.subject,
        }), bounded.signal);
      } finally {
        bounded.dispose();
      }
      await this.establishAuthorization(tokens, identity, generation);
    } catch (error) {
      // Once a switch request is sent, a lost response cannot prove whether
      // the server committed it. Discard the old local proof rather than risk
      // crossing a tenant boundary with stale process state.
      if (tokens?.refreshToken) this.revokeUncommitted(tokens.refreshToken);
      await this.clearLocal().catch(() => undefined);
      const authError = toNativeAuthError(error, 'NATIVE_TENANT_SWITCH_FAILED');
      this.input.state.setError(authError);
      throw authError;
    }
  }
  private performRefresh(generation: number): Promise<string> {
    const previous = this.stored;
    if (!previous) throw new Error('Native session disappeared during refresh.');
    return performNativeSessionRefresh({
      context: this.input,
      previous,
      generation,
      establish: (tokens, identity) => this.establish(tokens, identity, generation),
      discard: () => discardNativeSession(this.commitInput(), previous, generation),
    });
  }

  /** Serialize every operation that reads or consumes the rotating proof. */
  private runCredentialOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.credentialOperationTail.then(operation, operation);
    this.credentialOperationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private commitInput() {
    return {
      context: this.input,
      current: () => this.stored,
      replaceCurrent: (session: NativeStoredSession | null) => { this.stored = session; },
    };
  }

  private revokeUncommitted(refreshToken: string): void {
    revokeNativeRefreshTokenBestEffort({
      metadata: this.input.metadata,
      clientId: this.input.clientId,
      fetch: this.input.fetch,
      networkTimeoutMs: this.input.networkTimeoutMs,
    }, refreshToken);
  }
}

function sessionRequired(): NativeAuthError {
  return new NativeAuthError(
    'An authenticated native session is required.', 'NATIVE_SESSION_REQUIRED', 401,
  );
}
