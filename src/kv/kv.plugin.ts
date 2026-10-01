/**
 * kv.plugin.ts
 *
 * Elysia integration for the platform KV/cache service. This plugin owns
 * service startup, shutdown, and context decoration only; HTTP routes and
 * app-factory storage composition are handled elsewhere.
 */

import { Elysia } from 'elysia';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { KvService, type KvServiceConfig } from './kv-service';

let kvService: KvService | null = null;

/** Return the active KV service, or null when the plugin has not started. */
export function getKvService(): KvService | null {
  return kvService;
}

/** Clear the active KV service only if it still matches the expected service. */
export function clearKvService(service: KvService | null = null): void {
  if (!service || kvService === service) kvService = null;
}

/** Config accepted by the KV Elysia plugin. */
export interface KvPluginConfig extends KvServiceConfig {
  /** Optional prebuilt service for tests or custom runtime composition. */
  service?: KvService;
}

/**
 * Create the KV/cache Elysia plugin.
 *
 * The plugin exposes `kv`, `kvService`, `counter`, and `limiter` on Elysia
 * context. It does not register public HTTP routes.
 */
export function createKvPlugin(config: KvPluginConfig = {}) {
  const service = config.service ?? new KvService(config);

  return new Elysia({ name: 'kv' })
    .onStart(async () => {
      try {
        await service.start();
        kvService = service;
        emitPlatformCode(OBS_CODES.KV_STARTED, {
          metadata: { ...service.status() },
        });
      } catch (error) {
        emitPlatformCode(OBS_CODES.KV_START_FAILED, {
          error,
        });
        throw error;
      }
    })
    .onBeforeHandle({ as: 'global' }, async function waitForKvReadiness() {
      // Elysia begins accepting connections before asynchronous onStart hooks
      // necessarily settle. Gate every downstream route on KV recovery so the
      // first request cannot observe an empty engine or race a rejected write.
      await service.start();
    })
    .onStop(async () => {
      try {
        await service.stop();
        clearKvService(service);
        emitPlatformCode(OBS_CODES.KV_STOPPED);
      } catch (error) {
        emitPlatformCode(OBS_CODES.KV_STOP_FAILED, {
          error,
        });
        throw error;
      }
    })
    .derive({ as: 'global' }, () => ({
      kv: service,
      kvService: service,
      counter: service.counters,
      limiter: service.limiter,
    }));
}
