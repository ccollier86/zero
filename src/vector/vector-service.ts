/**
 * vector-service.ts
 *
 * Framework-neutral vector service for Zero app code. This file owns the
 * public storage/search API, scoped access helpers, and observability around
 * operations; it does not know zvec internals, execute AI models, or register
 * HTTP routes.
 */

import { VectorError } from './vector-error';
import {
  extractSimpleEqualityMetadata,
  getVectorFilterFields,
  mergeVectorFilters,
  recordMatchesVectorFilter,
} from './vector-filter';
import {
  emitVectorOperationCompleted,
  emitVectorOperationFailed,
} from './vector-observability';
import { VectorRegistry } from './vector-registry';
import type {
  StoredVectorRecord,
  VectorDeleteResult,
  VectorFetchOptions,
  VectorFilter,
  VectorMetadata,
  VectorQueryOptions,
  VectorRecord,
  VectorStats,
  VectorWriteResult,
} from './vector-types';

/** Framework-neutral API for app-owned vector storage and search. */
export class VectorService {
  /** Create a vector service from a registry of named indexes. */
  constructor(private readonly registry: VectorRegistry) {}

  /** List configured index names without opening collections. */
  listIndexes(): string[] {
    return this.registry.listIndexes();
  }

  /** Canonical list alias for listIndexes(). */
  list(): string[] {
    return this.listIndexes();
  }

  /** Insert or update vector records in an index, defaulting to the default index. */
  async upsert(records: VectorRecord | readonly VectorRecord[]): Promise<VectorWriteResult>;
  async upsert(index: string, records: VectorRecord | readonly VectorRecord[]): Promise<VectorWriteResult>;
  async upsert(
    indexOrRecords: string | VectorRecord | readonly VectorRecord[],
    maybeRecords?: VectorRecord | readonly VectorRecord[]
  ): Promise<VectorWriteResult> {
    const { index, value } = parseIndexAndValue(indexOrRecords, maybeRecords);
    const records = arrayOf(value);
    return this.runOperation('upsert', index, records.length, undefined, async () => {
      const result = await this.registry.getIndex(index).upsert(records);
      if (!result.ok) {
        emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', 'Vector upsert returned errors.'), {
          index: index ?? this.registry.defaultIndex,
          operation: 'upsert',
          documents: result.count,
          errors: result.errors.length,
        });
      }
      return result;
    });
  }

  /** Search an index using vector similarity, scalar filters, or both. */
  async query(options: VectorQueryOptions): Promise<StoredVectorRecord[]>;
  async query(index: string, options: VectorQueryOptions): Promise<StoredVectorRecord[]>;
  async query(
    indexOrOptions: string | VectorQueryOptions,
    maybeOptions?: VectorQueryOptions
  ): Promise<StoredVectorRecord[]> {
    const { index, value: options } = parseIndexAndValue(indexOrOptions, maybeOptions);
    return this.runOperation('query', index, undefined, options.filter, () => this.registry.getIndex(index).query(options));
  }

  /** Search alias for query(). */
  async search(options: VectorQueryOptions): Promise<StoredVectorRecord[]>;
  async search(index: string, options: VectorQueryOptions): Promise<StoredVectorRecord[]>;
  async search(
    indexOrOptions: string | VectorQueryOptions,
    maybeOptions?: VectorQueryOptions
  ): Promise<StoredVectorRecord[]> {
    if (typeof indexOrOptions === 'string') {
      return this.query(indexOrOptions, maybeOptions!);
    }
    return this.query(indexOrOptions);
  }

  /** Fetch records by id from an index, defaulting to the default index. */
  async fetch(ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]>;
  async fetch(index: string, ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]>;
  async fetch(
    indexOrIds: string | readonly string[],
    maybeIdsOrOptions?: string | readonly string[] | VectorFetchOptions,
    maybeOptions?: VectorFetchOptions
  ): Promise<StoredVectorRecord[]> {
    const { index, ids, options } = parseFetchArgs(indexOrIds, maybeIdsOrOptions, maybeOptions);
    return this.runOperation('fetch', index, ids.length, undefined, () => this.registry.getIndex(index).fetch(ids, options));
  }

  /** Canonical get alias for fetch(). */
  async get(ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]>;
  async get(index: string, ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]>;
  async get(
    indexOrIds: string | readonly string[],
    maybeIdsOrOptions?: string | readonly string[] | VectorFetchOptions,
    maybeOptions?: VectorFetchOptions
  ): Promise<StoredVectorRecord[]> {
    if (typeof maybeIdsOrOptions === 'string' || isStringArray(maybeIdsOrOptions)) {
      return this.fetch(indexOrIds as string, maybeIdsOrOptions, maybeOptions);
    }
    return this.fetch(indexOrIds, maybeIdsOrOptions);
  }

  /** Delete records by id from an index, defaulting to the default index. */
  async delete(ids: string | readonly string[]): Promise<VectorDeleteResult>;
  async delete(index: string, ids: string | readonly string[]): Promise<VectorDeleteResult>;
  async delete(
    indexOrIds: string | readonly string[],
    maybeIds?: string | readonly string[]
  ): Promise<VectorDeleteResult> {
    const { index, ids } = parseDeleteArgs(indexOrIds, maybeIds);
    return this.runOperation('delete', index, ids.length, undefined, async () => {
      const result = await this.registry.getIndex(index).delete(ids);
      if (!result.ok) {
        emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', 'Vector delete returned errors.'), {
          index: index ?? this.registry.defaultIndex,
          operation: 'delete',
          documents: result.count,
          errors: result.errors.length,
        });
      }
      return result;
    });
  }

  /** Delete records that match a scalar filter. */
  async deleteWhere(filter: VectorFilter): Promise<VectorDeleteResult>;
  async deleteWhere(index: string, filter: VectorFilter): Promise<VectorDeleteResult>;
  async deleteWhere(
    indexOrFilter: string | VectorFilter,
    maybeFilter?: VectorFilter
  ): Promise<VectorDeleteResult> {
    const { index, value: filter } = parseIndexAndValue(indexOrFilter, maybeFilter);
    return this.runOperation('deleteWhere', index, undefined, filter, () => this.registry.getIndex(index).deleteWhere(filter));
  }

  /** Return zvec stats for one index or every configured index. */
  stats(): Promise<VectorStats[]>;
  stats(index: string): Promise<VectorStats>;
  stats(index?: string): Promise<VectorStats | VectorStats[]> {
    return this.registry.stats(index);
  }

  /** Canonical status alias for stats(). */
  status(): Promise<VectorStats[]>;
  status(index: string): Promise<VectorStats>;
  status(index?: string): Promise<VectorStats | VectorStats[]> {
    return index === undefined ? this.stats() : this.stats(index);
  }

  /** Explicit getStatus alias for stats(). */
  getStatus(): Promise<VectorStats[]>;
  getStatus(index: string): Promise<VectorStats>;
  getStatus(index?: string): Promise<VectorStats | VectorStats[]> {
    return index === undefined ? this.stats() : this.stats(index);
  }

  /** Optimize one index or every configured index. */
  async optimize(index?: string): Promise<void> {
    if (index) {
      await this.runOperation('optimize', index, undefined, undefined, () => this.registry.getIndex(index).optimize());
      return;
    }
    await Promise.all(this.registry.listIndexes().map((name) => this.optimize(name)));
  }

  /** Create a scoped helper that ANDs every read/delete with a required filter. */
  scope(filter: VectorFilter): VectorScope;
  scope(index: string, filter: VectorFilter): VectorScope;
  scope(indexOrFilter: string | VectorFilter, maybeFilter?: VectorFilter): VectorScope {
    const { index, value: filter } = parseIndexAndValue(indexOrFilter, maybeFilter);
    return new VectorScope(this, index ?? this.registry.defaultIndex, filter);
  }

  /** Close all opened vector indexes. */
  dispose(): Promise<void> {
    return this.registry.dispose();
  }

  private async runOperation<T>(
    operation: string,
    index: string | undefined,
    documents: number | undefined,
    filter: VectorFilter | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await run();
      emitVectorOperationCompleted({
        index: index ?? this.registry.defaultIndex,
        operation,
        documents,
        durationMs: Date.now() - startedAt,
        filterFields: getVectorFilterFields(filter),
      });
      return result;
    } catch (error) {
      emitVectorOperationFailed(error, {
        index: index ?? this.registry.defaultIndex,
        operation,
        documents,
        durationMs: Date.now() - startedAt,
        filterFields: getVectorFilterFields(filter),
      });
      throw error;
    }
  }
}

/** Index-bound helper that enforces a required scalar filter on operations. */
export class VectorScope {
  /** Create a scoped vector helper from a service, index, and required filter. */
  constructor(
    private readonly service: VectorService,
    private readonly index: string,
    private readonly filter: VectorFilter
  ) {}

  /** Insert records after stamping simple equality values from the scope. */
  upsert(records: VectorRecord | readonly VectorRecord[]): Promise<VectorWriteResult> {
    const scopeMetadata = extractSimpleEqualityMetadata(this.filter);
    const scopedRecords = arrayOf(records).map((record) => ({
      ...record,
      metadata: mergeScopeMetadata(scopeMetadata, record.metadata),
    }));
    return this.service.upsert(this.index, scopedRecords);
  }

  /** Query this scope by ANDing the scope filter with caller filters. */
  query(options: VectorQueryOptions): Promise<StoredVectorRecord[]> {
    return this.service.query(this.index, {
      ...options,
      filter: mergeVectorFilters(this.filter, options.filter),
    });
  }

  /** Search alias for scoped query(). */
  search(options: VectorQueryOptions): Promise<StoredVectorRecord[]> {
    return this.query(options);
  }

  /** Fetch records by id, then apply the scope filter in memory to prevent leaks. */
  async fetch(ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]> {
    const records = await this.service.fetch(this.index, ids, options);
    return records.filter((record) => recordMatchesVectorFilter(record, this.filter));
  }

  /** Canonical get alias for scoped fetch(). */
  get(ids: string | readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]> {
    return this.fetch(ids, options);
  }

  /** Delete records in this scope that also match the caller filter. */
  deleteWhere(filter?: VectorFilter): Promise<VectorDeleteResult> {
    return this.service.deleteWhere(this.index, mergeVectorFilters(this.filter, filter)!);
  }

  /** Return stats for the underlying index. */
  stats(): Promise<VectorStats> {
    return this.service.stats(this.index);
  }

  /** Canonical status alias for scoped stats(). */
  status(): Promise<VectorStats> {
    return this.stats();
  }
}

function parseIndexAndValue<T>(
  indexOrValue: string | T,
  maybeValue: T | undefined
): { index?: string; value: T } {
  if (typeof indexOrValue === 'string') {
    if (maybeValue === undefined) {
      throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector index call is missing a value.', { index: indexOrValue });
    }
    return { index: indexOrValue, value: maybeValue };
  }
  return { value: indexOrValue };
}

function parseFetchArgs(
  indexOrIds: string | readonly string[],
  maybeIdsOrOptions: string | readonly string[] | VectorFetchOptions | undefined,
  maybeOptions: VectorFetchOptions | undefined
): { index?: string; ids: string[]; options?: VectorFetchOptions } {
  if (typeof indexOrIds === 'string') {
    if (typeof maybeIdsOrOptions === 'string' || isStringArray(maybeIdsOrOptions)) {
      return { index: indexOrIds, ids: idsArray(maybeIdsOrOptions), options: maybeOptions };
    }
    return { ids: [indexOrIds], options: isFetchOptions(maybeIdsOrOptions) ? maybeIdsOrOptions : maybeOptions };
  }

  const options = isFetchOptions(maybeIdsOrOptions)
    ? maybeIdsOrOptions
    : maybeOptions;
  return {
    ids: idsArray(indexOrIds),
    options,
  };
}

function parseDeleteArgs(
  indexOrIds: string | readonly string[],
  maybeIds: string | readonly string[] | undefined
): { index?: string; ids: string[] } {
  if (typeof indexOrIds === 'string' && maybeIds !== undefined) {
    return { index: indexOrIds, ids: idsArray(maybeIds) };
  }
  return { ids: idsArray(indexOrIds) };
}

function arrayOf<T>(value: T | readonly T[]): T[] {
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

function idsArray(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? [value] : [...value];
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

function isFetchOptions(value: unknown): value is VectorFetchOptions {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeScopeMetadata(scope: VectorMetadata, metadata: VectorMetadata | undefined): VectorMetadata {
  const merged: VectorMetadata = { ...(metadata ?? {}) };
  for (const [key, value] of Object.entries(scope)) {
    if (merged[key] !== undefined && merged[key] !== value) {
      throw new VectorError('VECTOR_METADATA_INVALID', `Vector scope metadata conflict for "${key}".`, {
        field: key,
      });
    }
    merged[key] = value;
  }
  return merged;
}
