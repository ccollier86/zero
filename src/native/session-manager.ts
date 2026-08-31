/** Native session restoration, persistence, and serialized refresh rotation. */

import type { NativeStoredSession, NativeTokenSet } from './oidc-types';
import { isSupersededOperation } from './lifecycle';
import { commitNativeSession, discardNativeSession } from './session-commit';
import { storedSessionMatchesClient, type NativeSessionContext } from './session-context';
import { performNativeSessionRefresh } from './session-refresh';

export class NativeSessionManager {
  private stored: NativeStoredSession | null = null;
  private refreshing: { generation: number; promise: Promise<string | null> } | null = null;
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
    if (!force) {
      const current = this.input.state.usableAccessToken();
      if (current) return Promise.resolve(current);
    }
    if (!this.stored) return Promise.resolve(null);
    if (!this.refreshing || this.refreshing.generation !== generation) {
      const promise = this.performRefresh(generation).finally(() => {
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
  private commitInput() {
    return {
      context: this.input,
      current: () => this.stored,
      replaceCurrent: (session: NativeStoredSession | null) => { this.stored = session; },
    };
  }
}
