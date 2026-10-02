/**
 * token.plugin.ts
 *
 * Provides the Elysia integration and runtime singleton for Zero platform
 * tokens. This file owns plugin lifecycle and service exposure only; token
 * policy lives in PlatformTokenService and persistence lives in PlatformTokenStore.
 */

import { Elysia } from 'elysia';
import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformTokenServiceConfig } from './token-types';
import {
  PlatformTokenService,
  type PlatformTokenCodeEmitter,
} from './token-service';
import { PlatformTokenStore, definePlatformTokenTables } from './token-store';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_PLATFORM_TOKEN_SERVICE,
  ZERO_PLATFORM_TOKEN_STORE,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const tokenServiceProviders = new CompatibilityProviderRegistry<PlatformTokenService>(
  'Platform token service',
);
const tokenStoreProviders = new CompatibilityProviderRegistry<PlatformTokenStore>(
  'Platform token store',
);
const manualOwner = {};
let manualServiceRegistration: ReturnType<typeof tokenServiceProviders.register> | null = null;
let manualStoreRegistration: ReturnType<typeof tokenStoreProviders.register> | null = null;
let manualService: PlatformTokenService | null = null;

/** Platform token plugin options. */
export interface PlatformTokenPluginConfig extends PlatformTokenServiceConfig {
  /** Shared ReactiveDB instance supplied by createApp after sync starts. */
  db: ReactiveDB;
  runtime?: ZeroAppRuntime;
  onServiceCreated?: (service: PlatformTokenService) => void;
}

/** Return the current platform token service, or null before startup. */
export function getPlatformTokenService(): PlatformTokenService | null {
  return tokenServiceProviders.get();
}

/** Return the current platform token store, or null before startup. */
export function getPlatformTokenStore(): PlatformTokenStore | null {
  return tokenStoreProviders.get();
}

/**
 * Initialize platform token tables and singleton services without Elysia.
 *
 * Useful for tests and advanced apps that need the service outside createApp.
 */
export function configurePlatformTokens(config: PlatformTokenPluginConfig): PlatformTokenService {
  const emitCode = createPlatformTokenCodeEmitter(config.runtime);
  resetPlatformTokens();
  definePlatformTokenTables(config.db);
  const store = new PlatformTokenStore(config.db);
  const service = new PlatformTokenService(store, config, emitCode);
  manualService = service;
  manualStoreRegistration = tokenStoreProviders.register(manualOwner, () => store);
  manualServiceRegistration = tokenServiceProviders.register(manualOwner, () => service);
  return service;
}

/** Reset the manually configured compatibility provider when ownership matches. */
export function resetPlatformTokens(expected?: PlatformTokenService): void {
  if (expected && manualService !== expected) return;
  manualServiceRegistration?.unregister();
  manualStoreRegistration?.unregister();
  manualServiceRegistration = null;
  manualStoreRegistration = null;
  manualService = null;
}

/** Create the Elysia plugin that exposes `platformTokens` to route context. */
export function createPlatformTokenPlugin(config: PlatformTokenPluginConfig) {
  const emitCode = createPlatformTokenCodeEmitter(config.runtime);
  const owner = {};
  let store: PlatformTokenStore | null = null;
  let service: PlatformTokenService | null = null;
  let storeRegistration: ReturnType<typeof tokenStoreProviders.register> | null = null;
  let serviceRegistration: ReturnType<typeof tokenServiceProviders.register> | null = null;
  config.runtime?.addCleanup(() => storeRegistration?.unregister());
  config.runtime?.addCleanup(() => serviceRegistration?.unregister());

  return new Elysia({ name: 'platform.tokens' })
    .onStart(() => {
      definePlatformTokenTables(config.db);
      store = new PlatformTokenStore(config.db);
      service = new PlatformTokenService(store, config, emitCode);
      storeRegistration = tokenStoreProviders.register(owner, () => store);
      serviceRegistration = tokenServiceProviders.register(owner, () => service);
      config.runtime?.set(ZERO_PLATFORM_TOKEN_STORE, store);
      config.runtime?.set(ZERO_PLATFORM_TOKEN_SERVICE, service);
      config.onServiceCreated?.(service);
      emitCode(OBS_CODES.TOKENS_STARTED);
    })
    .onStop(() => {
      if (service) config.runtime?.clear(ZERO_PLATFORM_TOKEN_SERVICE, service);
      if (store) config.runtime?.clear(ZERO_PLATFORM_TOKEN_STORE, store);
      serviceRegistration?.unregister();
      storeRegistration?.unregister();
      serviceRegistration = null;
      storeRegistration = null;
      service = null;
      store = null;
      emitCode(OBS_CODES.TOKENS_STOPPED);
    })
    .derive({ as: 'global' }, () => ({
      platformTokens: service,
    }));
}

function createPlatformTokenCodeEmitter(
  runtime?: ZeroAppRuntime,
): PlatformTokenCodeEmitter {
  if (!runtime) return emitPlatformCode;
  const observability = runtime.require(ZERO_OBSERVABILITY_RUNTIME);
  return (definition, options) => emitPlatformCodeTo(
    observability,
    definition,
    options,
  );
}
