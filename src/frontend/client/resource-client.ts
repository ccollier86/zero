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

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Minimal transport required by ResourceClient. */
export interface ResourceClientTransport {
  fetch<T = unknown>(path: string, init?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<T>;
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

/** Options accepted by generated resource mutation methods. */
export interface ResourceMutationOptions {
  signal?: AbortSignal;
  /**
   * Logical request identity for safe replay after an uncertain transport
   * outcome. Reuse the same value only for the same mutation.
   */
  idempotencyKey?: string;
}

/**
 * A generated resource mutation failed before producing a success value.
 *
 * `idempotencyKey` is always the exact key sent by this client. A caller may
 * retry the same logical mutation with this key even when the key was
 * generated automatically and the original response was lost.
 */
export class ResourceMutationError extends Error {
  readonly cause: unknown;
  /** HTTP status when the underlying transport exposes one (for example FetchError). */
  readonly status: number | undefined;
  /** Parsed HTTP body when the underlying transport exposes one. */
  readonly body: unknown;

  constructor(
    message: string,
    readonly idempotencyKey: string,
    cause: unknown,
  ) {
    super(message);
    this.name = 'ResourceMutationError';
    this.cause = cause;
    const transportFailure = cause && typeof cause === 'object'
      ? cause as { status?: unknown; body?: unknown }
      : null;
    this.status = typeof transportFailure?.status === 'number'
      ? transportFailure.status
      : undefined;
    this.body = transportFailure?.body;
  }
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
  create(input: Partial<T>, options?: ResourceMutationOptions): Promise<T>;
  /** Update one resource row through generated policy-aware routes. */
  update(id: string, input: Partial<T>, options?: ResourceMutationOptions): Promise<T>;
  /** Delete one resource row through generated policy-aware routes. */
  delete(id: string, options?: ResourceMutationOptions): Promise<ResourceDeleteResult>;
  /** Alias for delete(), named for UI/action ergonomics. */
  remove(id: string, options?: ResourceMutationOptions): Promise<ResourceDeleteResult>;
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

  async function mutate<TResult>(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    requestOptions?: ResourceMutationOptions,
  ): Promise<TResult> {
    const idempotencyKey = normalizeMutationIdempotencyKey(
      requestOptions?.idempotencyKey,
    );
    try {
      return await transport.fetch<TResult>(path, {
        method,
        ...(body === undefined ? {} : { body }),
        headers: { 'Idempotency-Key': idempotencyKey },
        signal: requestOptions?.signal,
      });
    } catch (cause) {
      if (cause instanceof ResourceMutationError) throw cause;
      const message = cause instanceof Error
        ? cause.message
        : 'Resource mutation request failed';
      throw new ResourceMutationError(message, idempotencyKey, cause);
    }
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
      getRow(mutate<ResourceRowResult<T>>(
        resourcePath,
        'POST',
        input,
        requestOptions,
      )),
    update: (id, input, requestOptions) =>
      getRow(mutate<ResourceRowResult<T>>(
        rowPath(id),
        'PATCH',
        input,
        requestOptions,
      )),
    delete: (id, requestOptions) => mutate<ResourceDeleteResult>(
      rowPath(id),
      'DELETE',
      undefined,
      requestOptions,
    ),
    remove(id, requestOptions) {
      return this.delete(id, requestOptions);
    },
  };
}

function normalizeMutationIdempotencyKey(supplied: string | undefined): string {
  if (supplied === undefined) return `r_${globalThis.crypto.randomUUID()}`;
  const normalized = supplied.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new TypeError(
      'Resource mutation idempotencyKey must be 1-128 header-safe characters',
    );
  }
  return normalized;
}
