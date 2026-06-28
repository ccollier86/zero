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

let activeVectorService: VectorService | null = null;

/** Options for mounting the Zero vector Elysia plugin. */
export interface VectorPluginConfig {
  config: ResolvedVectorConfig;
  service?: VectorService;
  storeFactory?: VectorIndexStoreFactory;
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
  activeVectorService = service;

  return new Elysia({ name: 'zero-platform-vector' })
    .decorate('vectors', service)
    .onStart(() => {
      emitVectorConfigured({
        indexes: Object.keys(options.config.indexes).length,
      });
    })
    .onStop(async () => {
      await service.dispose();
      if (activeVectorService === service) activeVectorService = null;
    });
}

/**
 * Return the process-wide vector service created by createVectorPlugin().
 *
 * Returns null before the plugin is mounted. This is a server-side convenience
 * for jobs, workflows, and API handlers, not a browser API.
 */
export function getVectorStore(): VectorService | null {
  return activeVectorService;
}
