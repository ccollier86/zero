/**
 * vector-registry.ts
 *
 * Owns lazy construction and lifecycle of named vector index stores. This file
 * depends on the VectorIndexStore abstraction and zvec adapter factory only;
 * it does not expose app-facing methods or generate embeddings.
 */

import { VectorError } from './vector-error';
import { ZvecAdapter } from './zvec-adapter';
import type { emitPlatformCode } from '../observability/sink';
import type {
  ResolvedVectorConfig,
  ResolvedVectorIndexConfig,
  VectorIndexStore,
  VectorStats,
} from './vector-types';

/** Factory used by tests or future adapters to create index stores. */
export type VectorIndexStoreFactory = (config: ResolvedVectorIndexConfig) => VectorIndexStore;

/** Options for constructing a vector registry. */
export interface VectorRegistryOptions {
  config: ResolvedVectorConfig;
  storeFactory?: VectorIndexStoreFactory;
  /** Owning app emitter for the default adapter; custom factories own their telemetry. */
  emitCode?: typeof emitPlatformCode;
}

/** Lazy registry of configured vector indexes. */
export class VectorRegistry {
  private readonly stores = new Map<string, VectorIndexStore>();
  private readonly storeFactory: VectorIndexStoreFactory;

  /** Create a registry from resolved vector config. */
  constructor(private readonly options: VectorRegistryOptions) {
    this.storeFactory = options.storeFactory ?? ((config) => new ZvecAdapter({ config, emitCode: options.emitCode }));
  }

  /** Return the configured default index name. */
  get defaultIndex(): string {
    return this.options.config.defaultIndex;
  }

  /** Return configured index names without opening them. */
  listIndexes(): string[] {
    return Object.keys(this.options.config.indexes).sort();
  }

  /** Return a lazy store for the requested index, or the default index. */
  getIndex(name?: string): VectorIndexStore {
    const indexName = name ?? this.defaultIndex;
    const config = this.options.config.indexes[indexName];
    if (!config) {
      throw new VectorError('VECTOR_INDEX_NOT_FOUND', `Vector index "${indexName}" is not configured.`, {
        index: indexName,
      });
    }

    let store = this.stores.get(indexName);
    if (!store) {
      store = this.storeFactory(config);
      this.stores.set(indexName, store);
    }

    return store;
  }

  /** Return stats for one index or all configured indexes. */
  async stats(name?: string): Promise<VectorStats | VectorStats[]> {
    if (name) return this.getIndex(name).stats();
    return Promise.all(this.listIndexes().map((index) => this.getIndex(index).stats()));
  }

  /** Close all opened vector indexes. */
  async dispose(): Promise<void> {
    await Promise.all([...this.stores.values()].map((store) => store.dispose()));
    this.stores.clear();
  }
}
