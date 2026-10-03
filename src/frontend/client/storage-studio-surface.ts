/**
 * storage-studio-surface.ts
 *
 * Binds Storage Studio's portable HTTP contract to Zero's authenticated SDK
 * transport. Route construction and scope-result fencing live here; response
 * validation and mutation semantics remain in focused peers.
 */

import type {
  StorageStudioDriveListRequest,
  StorageStudioDriveUpdateRequest,
  StorageStudioLifecycleRequest,
  StorageStudioProvisionRequest,
} from '../../storage/storage-studio-contracts';
import type { FetchInit } from './sdk';
import type {
  StorageStudioMutationOptions,
  StorageStudioRequestOptions,
  StorageStudioSdkSurface,
} from './storage-studio-client-types';
import {
  StorageStudioMutationError,
  createStorageStudioOperationId,
  mutateStorageStudio,
  verifyStorageStudioMutationResponse,
} from './storage-studio-mutation';
import {
  parseStorageStudioCapabilities,
  parseStorageStudioDrive,
  parseStorageStudioDrivePage,
  parseStorageStudioJobPage,
  parseStorageStudioMutationReceipt,
} from './storage-studio-response';

export const STORAGE_STUDIO_API_PREFIX = '/storage/studio';

type StorageStudioFetch = <T = unknown>(path: string, init?: FetchInit) => Promise<T>;

/** Create the browser SDK surface over the shared authenticated transport. */
export function createStorageStudioSdkSurface(
  fetch: StorageStudioFetch,
): StorageStudioSdkSurface {
  let scopeKey: string | null = null;
  let scopeRevision = 0;

  const setScope = (nextScopeKey: string): void => {
    if (nextScopeKey === scopeKey) return;
    scopeKey = nextScopeKey;
    scopeRevision += 1;
  };
  const clear = (): void => {
    scopeKey = null;
    scopeRevision += 1;
  };
  const scoped = async <T,>(
    request: () => Promise<T>,
    discarded: (() => Error) | null = null,
  ): Promise<T> => {
    const captured = scopeRevision;
    const result = await request();
    if (captured !== scopeRevision) {
      if (discarded) throw discarded();
      const error = new Error(
        'Discarded a Storage Studio response from a previous authorization scope.',
      );
      error.name = 'AbortError';
      throw error;
    }
    return result;
  };
  const mutate = async <T,>(
    path: string,
    method: string,
    input: Readonly<object>,
    options: StorageStudioMutationOptions,
    parse: (value: unknown, operationId: string) => T,
  ): Promise<T> => {
    const operationId = options.operationId ?? createStorageStudioOperationId();
    return scoped(async () => {
      const result = await mutateStorageStudio<unknown>(fetch, path, method, input, {
        ...options,
        operationId,
      });
      return verifyStorageStudioMutationResponse(
        result.operationId,
        () => parse(result.value, result.operationId),
      );
    }, () => new StorageStudioMutationError(
      'Storage Studio authorization scope changed after the mutation was sent.',
      operationId,
      { outcome: 'unknown', requiresSameIdempotencyKey: true },
    ));
  };

  return Object.freeze({
    setScope,
    clear,

    getCapabilities(options: StorageStudioRequestOptions = {}) {
      return scoped(async () => parseStorageStudioCapabilities(await fetch<unknown>(
        `${STORAGE_STUDIO_API_PREFIX}/capabilities`,
        { method: 'GET', signal: options.signal },
      )));
    },

    listDrives(
      request: StorageStudioDriveListRequest = {},
      options: StorageStudioRequestOptions = {},
    ) {
      const query = driveListQuery(request);
      return scoped(async () => parseStorageStudioDrivePage(await fetch<unknown>(
        `${STORAGE_STUDIO_API_PREFIX}/drives${query}`,
        { method: 'GET', signal: options.signal },
      )));
    },

    getDrive(driveId: string, options: StorageStudioRequestOptions = {}) {
      return scoped(async () => parseStorageStudioDrive(await fetch<unknown>(
        `${STORAGE_STUDIO_API_PREFIX}/drives/${encodeURIComponent(driveId)}`,
        { method: 'GET', signal: options.signal },
      )));
    },

    getDriveByKey(
      key: string,
      owner?: 'organization' | 'personal',
      options: StorageStudioRequestOptions = {},
    ) {
      const query = owner ? `?owner=${encodeURIComponent(owner)}` : '';
      return scoped(async () => parseStorageStudioDrive(await fetch<unknown>(
        `${STORAGE_STUDIO_API_PREFIX}/drives/by-key/${encodeURIComponent(key)}${query}`,
        { method: 'GET', signal: options.signal },
      )));
    },

    listDriveJobs(
      driveId: string,
      request: { readonly cursor?: string; readonly limit?: number } = {},
      options: StorageStudioRequestOptions = {},
    ) {
      const query = new URLSearchParams();
      if (request.cursor) query.set('cursor', request.cursor);
      if (request.limit !== undefined) query.set('limit', String(request.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return scoped(async () => parseStorageStudioJobPage(await fetch<unknown>(
        `${STORAGE_STUDIO_API_PREFIX}/drives/${encodeURIComponent(driveId)}/jobs${suffix}`,
        { method: 'GET', signal: options.signal },
      )));
    },

    provisionDrive(
      request: Omit<StorageStudioProvisionRequest, 'operationId'>,
      options: StorageStudioMutationOptions = {},
    ) {
      return mutate(
        `${STORAGE_STUDIO_API_PREFIX}/drives`,
        'POST',
        request,
        options,
        parseStorageStudioMutationReceipt,
      );
    },

    updateDrive(
      driveId: string,
      request: Omit<StorageStudioDriveUpdateRequest, 'operationId'>,
      options: StorageStudioMutationOptions = {},
    ) {
      return mutate(
        `${STORAGE_STUDIO_API_PREFIX}/drives/${encodeURIComponent(driveId)}`,
        'PATCH',
        request,
        options,
        parseStorageStudioMutationReceipt,
      );
    },

    changeDriveLifecycle(
      driveId: string,
      request: Omit<StorageStudioLifecycleRequest, 'operationId'>,
      options: StorageStudioMutationOptions = {},
    ) {
      return mutate(
        `${STORAGE_STUDIO_API_PREFIX}/drives/${encodeURIComponent(driveId)}/lifecycle`,
        'POST',
        request,
        options,
        parseStorageStudioMutationReceipt,
      );
    },
  });
}

function driveListQuery(request: StorageStudioDriveListRequest): string {
  const query = new URLSearchParams();
  if (request.owner) query.set('owner', request.owner);
  if (request.lifecycle) query.set('lifecycle', request.lifecycle);
  if (request.search) query.set('search', request.search);
  if (request.cursor) query.set('cursor', request.cursor);
  if (request.limit !== undefined) query.set('limit', String(request.limit));
  const value = query.toString();
  return value ? `?${value}` : '';
}
