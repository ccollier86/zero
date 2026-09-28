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
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { ZERO_KV_SERVICE } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const kvProviders = new CompatibilityProviderRegistry<KvService>('KV service');
const kvRegistrations = new WeakMap<KvService, { unregister(): void }>();

/** Return the active KV service, or null when the plugin has not started. */
export function getKvService(): KvService | null {
  return kvProviders.get();
}

/** Clear the active KV service only if it still matches the expected service. */
export function clearKvService(service: KvService | null = null): void {
  if (!service) return;
  kvRegistrations.get(service)?.unregister();
  kvRegistrations.delete(service);
}

/** Config accepted by the KV Elysia plugin. */
export interface KvPluginConfig extends KvServiceConfig {
  /** Optional prebuilt service for tests or custom runtime composition. */
  service?: KvService;
  /** App-local runtime used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /** Composition callback for app factories and advanced integrations. */
  onServiceCreated?: (service: KvService) => void;
}

/**
 * Create the KV/cache Elysia plugin.
 *
 * The plugin exposes `kv`, `kvService`, `counter`, and `limiter` on Elysia
 * context. It does not register public HTTP routes.
 */
export function createKvPlugin(config: KvPluginConfig = {}) {
  const service = config.service ?? new KvService(config);
  const owner = {};
  let registration: ReturnType<typeof kvProviders.register> | null = null;
  let startupPromise: Promise<void> | null = null;
  config.runtime?.set(ZERO_KV_SERVICE, service);
  config.onServiceCreated?.(service);
  const clearRegistration = () => {
    config.runtime?.clear(ZERO_KV_SERVICE, service);
    clearKvService(service);
  };
  const ensureStarted = (): Promise<void> => {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      try {
        await service.start();
        emitPlatformCode(OBS_CODES.KV_STARTED, {
          metadata: { ...service.status() },
        });
      } catch (error) {
        emitPlatformCode(OBS_CODES.KV_START_FAILED, {
          error,
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    })();
    // Elysia's Bun adapter does not await onStart promises. Attach a handler
    // immediately; requests await the same promise below and cannot observe a
    // partially recovered service.
    void startupPromise.catch(() => undefined);
    return startupPromise;
  };
  config.runtime?.addCleanup(async () => {
    // createApp's stop barrier awaits runtime cleanup because Bun/Elysia does
    // not await async onStop hooks. Join the final flush/checkpoint here so an
    // app cannot report itself stopped while KV still owns its files.
    try {
      await service.stop();
    } finally {
      clearRegistration();
    }
  });

  return new Elysia({ name: 'kv' })
    .onStart((lifecycle) => {
      void ensureStarted().then(() => {
        if (!registration) {
          registration = kvProviders.register(owner, () => service);
          kvRegistrations.set(service, registration);
        }
      }).catch(async (startupError) => {
        try {
          await service.stop();
        } catch (cleanupError) {
          emitPlatformCode(OBS_CODES.KV_STOP_FAILED, { error: cleanupError });
        } finally {
          clearRegistration();
        }
        try {
          await lifecycle.server?.stop(true);
        } catch (transportError) {
          emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              [startupError, transportError],
              '[kv] Startup failed and the listener could not be stopped.',
            ),
            metadata: { phase: 'start', plugin: 'kv' },
          });
        }
      });
    })
    .onRequest(() => ensureStarted())
    .onStop(async () => {
      try {
        await service.stop();
        emitPlatformCode(OBS_CODES.KV_STOPPED);
      } catch (error) {
        emitPlatformCode(OBS_CODES.KV_STOP_FAILED, {
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      } finally {
        clearRegistration();
      }
    })
    .derive({ as: 'global' }, () => ({
      kv: service,
      kvService: service,
      counter: service.counters,
      limiter: service.limiter,
    }));
}
