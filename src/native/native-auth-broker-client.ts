/** NativeAuthClient proxy backed by one trusted credential-owning broker. */

import type { NativeFetch } from './adapter-types';
import { createAuthenticatedFetch } from './authenticated-fetch';
import { NativeAuthBrokerClientState } from './broker-client-state';
import { invokeNativeAuthBroker, positiveBrokerTimeout } from './broker-invocation';
import type { NativeAuthBrokerRequest, NativeAuthBrokerTransport } from './broker-types';
import type {
  NativeAuthClient, NativeAuthStateListener,
  NativeSignInOptions, NativeSignUpOptions,
} from './client-types';
import { NativeAuthError } from './errors';
import { resolveZeroNativeIssuer } from './server-url';

export interface NativeAuthBrokerClientOptions {
  transport: NativeAuthBrokerTransport;
  serverUrl: string;
  fetch?: NativeFetch;
  requestTimeoutMs?: number;
  authorizationTimeoutMs?: number;
}

export interface NativeAuthBrokerClient extends NativeAuthClient {
  dispose(): void;
}

export function createNativeAuthBrokerClient(
  options: NativeAuthBrokerClientOptions,
): NativeAuthBrokerClient {
  return new BrokerClient(options);
}
class BrokerClient implements NativeAuthBrokerClient {
  private readonly brokerState: NativeAuthBrokerClientState;
  private readonly unsubscribe: () => void;
  private readonly requestTimeoutMs: number;
  private readonly authorizationTimeoutMs: number;
  private readonly authenticatedFetch: NativeFetch;

  constructor(private readonly options: NativeAuthBrokerClientOptions) {
    const issuer = resolveZeroNativeIssuer(options.serverUrl);
    this.brokerState = new NativeAuthBrokerClientState(issuer);
    const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetcher) throw new NativeAuthError('A native fetch adapter is required.', 'NATIVE_FETCH_UNAVAILABLE');
    this.requestTimeoutMs = positiveBrokerTimeout(options.requestTimeoutMs ?? 30_000);
    this.authorizationTimeoutMs = positiveBrokerTimeout(options.authorizationTimeoutMs ?? 960_000);
    this.unsubscribe = options.transport.subscribeState((state) => this.brokerState.apply(state));
    this.authenticatedFetch = createAuthenticatedFetch(issuer, fetcher, {
      accessToken: () => this.getAccessToken(),
      refreshAfterUnauthorized: async () => {
        await this.refresh();
        return this.getAccessToken();
      },
    });
  }

  get state() { return this.brokerState.snapshot; }
  getUser() { return this.brokerState.snapshot.identity; }
  subscribe(listener: NativeAuthStateListener) { return this.brokerState.subscribe(listener); }
  initialize() { return this.stateCommand({ operation: 'initialize' }); }
  refresh() { return this.stateCommand({ operation: 'refresh' }); }
  async listTenants() {
    const response = await this.invoke(
      { operation: 'listTenants' }, undefined, this.requestTimeoutMs,
    );
    if (!response.tenantList) {
      throw new NativeAuthError(
        'Broker omitted the tenant list response.', 'NATIVE_BROKER_RESPONSE_INVALID',
      );
    }
    return response.tenantList;
  }
  switchTenant(tenantId: string) {
    return this.stateCommand({ operation: 'switchTenant', tenantId });
  }
  async signOut() { await this.invoke({ operation: 'signOut' }, undefined, this.requestTimeoutMs); }
  fetch(input: RequestInfo | URL, init?: RequestInit) { return this.authenticatedFetch(input, init); }
  signIn(options?: NativeSignInOptions) { return this.authorize('signIn', options); }
  signUp(options?: NativeSignUpOptions) { return this.authorize('signUp', options); }
  completeAuthorization(callbackUrl: string, signal?: AbortSignal) {
    return this.stateCommand({ operation: 'completeAuthorization', callbackUrl }, signal, true);
  }
  async getAccessToken() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.invoke(
        { operation: 'getAccessToken' }, undefined, this.requestTimeoutMs,
      );
      if (this.brokerState.acceptsAccessToken(response.snapshot.revision)) {
        return response.accessToken ?? null;
      }
      if (this.state.status !== 'authenticated') return null;
    }
    return null;
  }
  dispose() { this.unsubscribe(); this.brokerState.dispose(); }

  private authorize(operation: 'signIn' | 'signUp', options?: NativeSignInOptions) {
    const command: NativeAuthBrokerRequest = options?.loginHint
      ? { operation, loginHint: options.loginHint } : { operation };
    return this.stateCommand(command, options?.signal, true);
  }

  private async stateCommand(command: NativeAuthBrokerRequest, signal?: AbortSignal, long = false) {
    await this.invoke(command, signal, long ? this.authorizationTimeoutMs : this.requestTimeoutMs);
    return this.state;
  }

  private async invoke(command: NativeAuthBrokerRequest, source: AbortSignal | undefined, timeout: number) {
    return invokeNativeAuthBroker({
      transport: this.options.transport, command, source, timeoutMs: timeout,
      publish: (snapshot) => this.brokerState.apply(snapshot),
    });
  }
}
