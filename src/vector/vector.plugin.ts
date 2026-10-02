/**
 * vector.plugin.ts
 *
 * Elysia integration for Zero's local vector service. This plugin owns service
 * decoration and lifecycle cleanup only; vector storage/search stays in
 * VectorService and no public routes are registered by default.
 */

import { Elysia } from 'elysia';

import { VectorRegistry, type VectorIndexStoreFactory } from './vector-registry';
import { VectorService } from './vector-service';
import { emitVectorConfigured } from './vector-observability';
import type { ResolvedVectorConfig } from './vector-types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { ZERO_VECTOR_SERVICE } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const vectorProviders = new CompatibilityProviderRegistry<VectorService>('Vector service');

/** Options for mounting the Zero vector Elysia plugin. */
export interface VectorPluginConfig {
  config: ResolvedVectorConfig;
  service?: VectorService;
  storeFactory?: VectorIndexStoreFactory;
  runtime?: ZeroAppRuntime;
  onServiceCreated?: (service: VectorService) => void;
}

/**
 * Create the named Elysia plugin that decorates request context with `vectors`.
 *
 * The plugin is internal by default and does not register search or write
 * routes. App code can use getVectorStore() or the decorated service in
 * server-side handlers, loaders, jobs, and workflows.
 */
export function createVectorPlugin(options: VectorPluginConfig) {
  const registry = options.service
    ? null
    : new VectorRegistry({
        config: options.config,
        storeFactory: options.storeFactory,
      });
  const service = options.service ?? new VectorService(registry!);
  const owner = {};
  let started = false;
  const registration = vectorProviders.register(owner, () => started ? service : null);
  options.runtime?.set(ZERO_VECTOR_SERVICE, service);
  options.onServiceCreated?.(service);
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = (): Promise<void> => cleanupPromise ??= (async () => {
    try {
      await service.dispose();
    } finally {
      started = false;
      options.runtime?.clear(ZERO_VECTOR_SERVICE, service);
      registration.unregister();
    }
  })();
  options.runtime?.addCleanup(cleanup);

  return new Elysia({ name: 'zero-platform-vector' })
    .decorate('vectors', service)
    .onStart(() => {
      started = true;
      emitVectorConfigured({
        indexes: Object.keys(options.config.indexes).length,
      });
    })
    .onStop(async () => {
      await cleanup();
    });
}

/**
 * Return the process-wide vector service created by createVectorPlugin().
 *
 * Returns null before the plugin is mounted. This is a server-side convenience
 * for jobs, workflows, and API handlers, not a browser API.
 */
export function getVectorStore(): VectorService | null {
  return vectorProviders.get();
}
