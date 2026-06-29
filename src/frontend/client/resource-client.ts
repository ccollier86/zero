/**
 * resource-client.ts
 *
 * Owns the frontend SDK wrapper for generated Zero resource CRUD routes. This
 * file builds resource URLs and delegates transport to the main SDK client; it
 * does not manage React state, optimistic sync, or backend authorization.
 */

import type { Row } from '../../sync/types';
import {
  buildResourceListQuery,
  normalizeResourcePrefix,
  type DataPageFilters,
  type DataPageInfo,
  type DataPageSort,
} from './query-params';

/** Minimal transport required by ResourceClient. */
export interface ResourceClientTransport {
  fetch<T = unknown>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>;
}

/** Options shared by generated resource clients. */
export interface ResourceClientOptions {
  /** Generated resource route prefix. Default: `/api/resources`. */
  prefix?: string;
}

/** List options accepted by generated resource routes. */
export interface ResourceListOptions {
  filters?: DataPageFilters;
  sort?: DataPageSort | null;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

/** Generated resource list response. */
export interface ResourceListResult<T extends Row> {
  rows: T[];
  page: DataPageInfo;
}

/** Generated resource row response. */
export interface ResourceRowResult<T extends Row> {
  row: T;
}

/** Generated resource delete response. */
export interface ResourceDeleteResult {
  deleted: boolean;
  id: string;
}

/** Frontend client for one generated resource. */
export interface ResourceClient<T extends Row = Row> {
  /** Stable resource name used in generated route paths. */
  readonly name: string;
  /** List resource rows with server-side filters, sorting, and pagination. */
  list(options?: ResourceListOptions): Promise<ResourceListResult<T>>;
  /** Load one resource row by primary key. */
  get(id: string, options?: { signal?: AbortSignal }): Promise<T>;
  /** Create one resource row through generated policy-aware routes. */
  create(input: Partial<T>, options?: { signal?: AbortSignal }): Promise<T>;
  /** Update one resource row through generated policy-aware routes. */
  update(id: string, input: Partial<T>, options?: { signal?: AbortSignal }): Promise<T>;
  /** Delete one resource row through generated policy-aware routes. */
  delete(id: string, options?: { signal?: AbortSignal }): Promise<ResourceDeleteResult>;
  /** Alias for delete(), named for UI/action ergonomics. */
  remove(id: string, options?: { signal?: AbortSignal }): Promise<ResourceDeleteResult>;
}

/**
 * Create a typed client for one generated resource route group.
 *
 * The returned client uses the provided transport, so auth headers and token
 * refresh remain centralized in the main SDK client.
 */
export function createResourceClient<T extends Row = Row>(
  name: string,
  transport: ResourceClientTransport,
  options: ResourceClientOptions = {}
): ResourceClient<T> {
  const prefix = normalizeResourcePrefix(options.prefix ?? '/api/resources');
  const resourcePath = `${prefix}/${encodeURIComponent(name)}`;
  const rowPath = (id: string) => `${resourcePath}/${encodeURIComponent(id)}`;

  async function getRow(result: Promise<ResourceRowResult<T>>): Promise<T> {
    return (await result).row;
  }

  return {
    name,
    list: (listOptions = {}) => {
      const path = buildResourceListQuery(name, {
        prefix,
        filters: listOptions.filters,
        sort: listOptions.sort,
        limit: listOptions.limit,
        offset: listOptions.offset,
      });
      return transport.fetch<ResourceListResult<T>>(path, {
        method: 'GET',
        signal: listOptions.signal,
      });
    },
    get: (id, requestOptions) =>
      getRow(transport.fetch<ResourceRowResult<T>>(rowPath(id), {
        method: 'GET',
        signal: requestOptions?.signal,
      })),
    create: (input, requestOptions) =>
      getRow(transport.fetch<ResourceRowResult<T>>(resourcePath, {
        method: 'POST',
        body: input,
        signal: requestOptions?.signal,
      })),
    update: (id, input, requestOptions) =>
      getRow(transport.fetch<ResourceRowResult<T>>(rowPath(id), {
        method: 'PATCH',
        body: input,
        signal: requestOptions?.signal,
      })),
    delete: (id, requestOptions) =>
      transport.fetch<ResourceDeleteResult>(rowPath(id), {
        method: 'DELETE',
        signal: requestOptions?.signal,
      }),
    remove(id, requestOptions) {
      return this.delete(id, requestOptions);
    },
  };
}
