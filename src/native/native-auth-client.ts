/** Public native/mobile authentication client facade. */

import type {
  NativeAuthClient, NativeAuthClientOptions, NativeAuthState, NativeAuthStateListener,
  NativeSignInOptions, NativeSignUpOptions,
} from './client-types';
import { resolveNativeAuthConfig } from './config';
import { signOutNativeClient } from './client-sign-out';
import { NativeRuntimeLoader } from './runtime-loader';
import { NativeLifecycle } from './lifecycle';
import { NativeAuthStateStore } from './state-store';
import { NativeVaultStore } from './vault-store';

/** Create an OIDC public client; a client secret is neither accepted nor needed. */
export function createNativeAuthClient(options: NativeAuthClientOptions): NativeAuthClient {
  return new NativeAuthClientImpl(options);
}
class NativeAuthClientImpl implements NativeAuthClient {
  private readonly config;
  private readonly stateStore;
  private readonly vault;
  private readonly loader;
  private readonly lifecycle;

  constructor(options: NativeAuthClientOptions) {
    this.config = resolveNativeAuthConfig(options);
    this.stateStore = new NativeAuthStateStore(this.config.now);
    this.vault = new NativeVaultStore(this.config.vault, this.config.storageNamespace);
    this.lifecycle = new NativeLifecycle();
    this.loader = new NativeRuntimeLoader(
      this.config, this.vault, this.stateStore, this.lifecycle,
    );
  }

  get state(): NativeAuthState {
    return this.stateStore.state;
  }

  subscribe(listener: NativeAuthStateListener): () => void {
    return this.stateStore.subscribe(listener);
  }

  async initialize(): Promise<NativeAuthState> {
    await this.loader.initialize();
    return this.state;
  }

  async signIn(options?: NativeSignInOptions): Promise<NativeAuthState> {
    const generation = this.lifecycle.capture();
    const runtime = await this.loader.runtime();
    this.lifecycle.assertCurrent(generation);
    await runtime.flow.signIn(options, generation);
    this.loader.markInitialized();
    return this.state;
  }

  async signUp(options?: NativeSignUpOptions): Promise<NativeAuthState> {
    const generation = this.lifecycle.capture();
    const runtime = await this.loader.runtime();
    this.lifecycle.assertCurrent(generation);
    await runtime.flow.signUp(options, generation);
    this.loader.markInitialized();
    return this.state;
  }

  async completeAuthorization(callbackUrl: string, signal?: AbortSignal): Promise<NativeAuthState> {
    const generation = this.lifecycle.capture();
    const runtime = await this.loader.runtime();
    this.lifecycle.assertCurrent(generation);
    await runtime.flow.completeAuthorization(callbackUrl, signal, generation);
    this.loader.markInitialized();
    return this.state;
  }

  async refresh(): Promise<NativeAuthState> {
    const wasInitialized = this.loader.initialized;
    const runtime = await this.loader.initializedRuntime();
    if (wasInitialized) await runtime.sessions.refresh(true);
    return this.state;
  }

  async listTenants() {
    return (await this.loader.initializedRuntime()).sessions.listTenants();
  }

  async switchTenant(tenantId: string): Promise<NativeAuthState> {
    await (await this.loader.initializedRuntime()).sessions.switchTenant(tenantId);
    return this.state;
  }

  getUser() {
    return this.state.identity;
  }

  async getAccessToken(): Promise<string | null> {
    return (await this.loader.initializedRuntime()).sessions.accessToken();
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return (await this.loader.initializedRuntime()).fetch(input, init);
  }

  async signOut(): Promise<void> {
    await signOutNativeClient({
      config: this.config, vault: this.vault, lifecycle: this.lifecycle,
      loader: this.loader, state: this.stateStore,
    });
  }
}
