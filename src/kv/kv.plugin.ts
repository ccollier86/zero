/**
 * kv.plugin.ts
 *
 * Elysia integration for the platform KV/cache service. This plugin owns
 * service startup, shutdown, and context decoration only; HTTP routes and
 * app-factory storage composition are handled elsewhere.
 */

import { Elysia } from 'elysia';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import { KvError } from './kv-errors';
import { KvService, type KvServiceConfig } from './kv-service';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_KV_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../runtime/service-keys';
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
  /** Cached startup boundary used by managed app factories before publication. */
  onInitializerCreated?: (initialize: () => Promise<void>) => void;
}

/**
 * Create the KV/cache Elysia plugin.
 *
 * The plugin exposes `kv`, `kvService`, `counter`, and `limiter` on Elysia
 * context. It does not register public HTTP routes.
 */
export function createKvPlugin(config: KvPluginConfig = {}) {
  const observability = config.runtime?.require(ZERO_OBSERVABILITY_RUNTIME) ?? null;
  const emitCode: typeof emitPlatformCode = observability
    ? (definition, options) => emitPlatformCodeTo(observability, definition, options)
    : config.emitCode ?? emitPlatformCode;
  const service = config.service ?? new KvService({ ...config, emitCode });
  const owner = {};
  let registration: ReturnType<typeof kvProviders.register> | null = null;
  let startupPromise: Promise<void> | null = null;
  let stoppingPromise: Promise<void> | null = null;
  let disposed = false;
  let started = false;
  let stopOutcomeReported = false;
  config.runtime?.set(ZERO_KV_SERVICE, service);
  config.onServiceCreated?.(service);
  const clearRegistration = () => {
    config.runtime?.clear(ZERO_KV_SERVICE, service);
    clearKvService(service);
  };
  const ensureStarted = (): Promise<void> => {
    if (disposed) {
      return Promise.reject(new KvError(
        'KV_SERVICE_STOPPING',
        'KV plugin cannot restart after its owning app begins shutdown.',
      ));
    }
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      try {
        await service.start();
        started = true;
        emitCode(OBS_CODES.KV_STARTED, {
          metadata: { ...service.status() },
        });
      } catch (error) {
        emitCode(OBS_CODES.KV_START_FAILED, { error });
        throw error;
      }
    })();
    // Elysia's Bun adapter does not await onStart promises. Attach a handler
    // immediately; requests await the same promise below and cannot observe a
    // partially recovered service.
    void startupPromise.catch(() => undefined);
    return startupPromise;
  };
  const stopService = (reportSuccess: boolean): Promise<void> => {
    disposed = true;
    stoppingPromise ??= service.stop();
    return stoppingPromise.then(
      () => {
        if (stopOutcomeReported) return;
        stopOutcomeReported = true;
        if (reportSuccess && started) emitCode(OBS_CODES.KV_STOPPED);
      },
      (error: unknown) => {
        if (!stopOutcomeReported) {
          stopOutcomeReported = true;
          emitCode(OBS_CODES.KV_STOP_FAILED, { error });
        }
        throw error;
      },
    ).finally(clearRegistration);
  };
  config.onInitializerCreated?.(ensureStarted);
  config.runtime?.addCleanup(async () => {
    // createApp's stop barrier awaits runtime cleanup because Bun/Elysia does
    // not await async onStop hooks. Join the final flush/checkpoint here so an
    // app cannot report itself stopped while KV still owns its files.
    await stopService(true);
  });

  return new Elysia({ name: 'kv' })
    .onStart((lifecycle) => {
      void ensureStarted().then(() => {
        if (!disposed && !registration) {
          registration = kvProviders.register(owner, () => service);
          kvRegistrations.set(service, registration);
        }
      }).catch(async (startupError) => {
        try {
          await stopService(false);
        } catch {
          // stopService reports the shared cleanup failure exactly once.
        }
        try {
          await lifecycle.server?.stop(true);
        } catch (transportError) {
          emitCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              [startupError, transportError],
              '[kv] Startup failed and the listener could not be stopped.',
            ),
            metadata: { phase: 'start', plugin: 'kv' },
          });
        }
      });
    })
    .onBeforeHandle({ as: 'global' }, () => ensureStarted())
    .onStop(() => {
      // Bun/Elysia does not await async onStop hooks. Managed apps observe the
      // same cached result through the runtime cleanup barrier; standalone
      // failures are already emitted here and must not become unhandled.
      void stopService(true).catch(() => undefined);
    })
    .derive({ as: 'global' }, () => ({
      kv: service,
      kvService: service,
      counter: service.counters,
      limiter: service.limiter,
    }));
}
