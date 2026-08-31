/** Lazy discovery/runtime construction and single-flight session initialization. */

import type { ResolvedNativeAuthConfig } from './config';
import { toNativeAuthError } from './errors';
import { createNativeAuthRuntime, type NativeAuthRuntime } from './runtime';
import type { NativeLifecycle } from './lifecycle';
import type { NativeAuthStateStore } from './state-store';
import type { NativeVaultStore } from './vault-store';

export class NativeRuntimeLoader {
  private runtimePromise: Promise<NativeAuthRuntime> | null = null;
  private runtimeValue: NativeAuthRuntime | null = null;
  private initializePromise: Promise<void> | null = null;
  private initializedComplete = false;

  constructor(
    private readonly config: ResolvedNativeAuthConfig,
    private readonly vault: NativeVaultStore,
    private readonly state: NativeAuthStateStore,
    private readonly lifecycle: NativeLifecycle,
  ) {}

  runtime(): Promise<NativeAuthRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = createNativeAuthRuntime(
        this.config, this.vault, this.state, this.lifecycle,
      ).then((runtime) => {
        this.runtimeValue = runtime;
        return runtime;
      })
        .catch((error) => {
          this.runtimePromise = null;
          throw error;
        });
    }
    return this.runtimePromise;
  }

  currentRuntime(): NativeAuthRuntime | null {
    return this.runtimeValue;
  }

  get initialized(): boolean {
    return this.initializedComplete;
  }

  async initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeInternal()
        .then(() => { this.initializedComplete = true; })
        .catch((error) => {
          this.initializePromise = null;
          this.initializedComplete = false;
          const authError = toNativeAuthError(error, 'NATIVE_INITIALIZE_FAILED');
          this.state.setError(authError);
          throw authError;
        });
    }
    await this.initializePromise;
  }

  async initializedRuntime(): Promise<NativeAuthRuntime> {
    const runtime = await this.runtime();
    await this.initialize();
    return runtime;
  }

  markInitialized(): void {
    this.initializedComplete = true;
    this.initializePromise = Promise.resolve();
  }

  private async initializeInternal(): Promise<void> {
    await (await this.runtime()).sessions.initialize();
  }
}
