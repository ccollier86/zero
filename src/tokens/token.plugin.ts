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
import { emitPlatformCode } from '../observability/sink';
import type { PlatformTokenServiceConfig } from './token-types';
import { PlatformTokenService } from './token-service';
import { PlatformTokenStore, definePlatformTokenTables } from './token-store';

let tokenStore: PlatformTokenStore | null = null;
let tokenService: PlatformTokenService | null = null;

/** Platform token plugin options. */
export interface PlatformTokenPluginConfig extends PlatformTokenServiceConfig {
  /** Shared ReactiveDB instance supplied by createApp after sync starts. */
  db: ReactiveDB;
}

/** Return the current platform token service, or null before startup. */
export function getPlatformTokenService(): PlatformTokenService | null {
  return tokenService;
}

/** Return the current platform token store, or null before startup. */
export function getPlatformTokenStore(): PlatformTokenStore | null {
  return tokenStore;
}

/**
 * Initialize platform token tables and singleton services without Elysia.
 *
 * Useful for tests and advanced apps that need the service outside createApp.
 */
export function configurePlatformTokens(config: PlatformTokenPluginConfig): PlatformTokenService {
  definePlatformTokenTables(config.db);
  tokenStore = new PlatformTokenStore(config.db);
  tokenService = new PlatformTokenService(tokenStore, config);
  return tokenService;
}

/** Reset the process-local platform token singleton when ownership matches. */
export function resetPlatformTokens(expected?: PlatformTokenService): void {
  if (expected && tokenService !== expected) return;
  tokenStore = null;
  tokenService = null;
}

/** Create the Elysia plugin that exposes `platformTokens` to route context. */
export function createPlatformTokenPlugin(config: PlatformTokenPluginConfig) {
  let ownedService: PlatformTokenService | null = null;
  return new Elysia({ name: 'platform.tokens' })
    .onStart(() => {
      ownedService = configurePlatformTokens(config);
      emitPlatformCode(OBS_CODES.TOKENS_STARTED);
    })
    .onStop(() => {
      if (!ownedService) return;
      resetPlatformTokens(ownedService);
      ownedService = null;
      emitPlatformCode(OBS_CODES.TOKENS_STOPPED);
    })
    .derive({ as: 'global' }, () => ({
      platformTokens: tokenService,
    }));
}
