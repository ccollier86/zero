/**
 * upload-queue-hooks.ts
 *
 * Composes the single-file storage upload hook into a sequential upload queue.
 * This file owns queue UI state only; multipart transport and token refresh
 * remain inside `useUpload`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../frontend/client/authorization-scope-hooks';
import { useClientMaybe } from '../frontend/client/client-context';
import type { FileInfo } from './types';
import { useUpload, type UploadFileOptions } from './storage-hooks';

export type UploadQueueItemStatus = 'queued' | 'uploading' | 'complete' | 'error' | 'cancelled';

export interface UploadQueueFilesOptions extends UploadFileOptions {
  /** Resolve a per-file destination path for multi-file uploads. */
  resolvePath?: (file: File) => string | undefined;
}

export interface UploadQueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: UploadQueueItemStatus;
  error: string | null;
  result: FileInfo | null;
}

export interface UseUploadQueueReturn {
  items: UploadQueueItem[];
  uploading: boolean;
  progress: number;
  completed: UploadQueueItem[];
  failed: UploadQueueItem[];
  uploadFiles: (driveId: string, files: File[] | FileList, options?: UploadQueueFilesOptions) => Promise<FileInfo[]>;
  cancel: () => void;
  clear: () => void;
}

function createQueueItem(file: File): UploadQueueItem {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    file,
    name: file.name,
    size: file.size,
    progress: 0,
    status: 'queued',
    error: null,
    result: null,
  };
}

function updateQueueItem(
  items: UploadQueueItem[],
  id: string,
  partial: Partial<UploadQueueItem>,
): UploadQueueItem[] {
  return items.map((item) => item.id === id ? { ...item, ...partial } : item);
}

/** @internal Final result gate shared by queue execution and regression tests. */
export function assertUploadQueueScopeCurrent(
  currentKey: string,
  ready: boolean,
  requestBoundaryKey: string,
): void {
  if (!isAuthorizationScopeCallbackCurrent(currentKey, ready, requestBoundaryKey)) {
    throw staleUploadScopeError();
  }
}

/**
 * Upload multiple files sequentially while exposing per-file progress.
 *
 * `cancel()` aborts the active upload and marks any remaining queued files as
 * cancelled.
 */
export function useUploadQueue(): UseUploadQueueReturn {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const uploader = useUpload();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const cancelledRef = useRef(false);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );

  useEffect(() => {
    cancelledRef.current = true;
    uploader.reset();
    setItems([]);
    setUploading(false);
    setLoadedBoundaryKey(authorizationBoundary.key);
  }, [authorizationBoundary.key, uploader.reset]);

  const uploadFiles = useCallback(
    async (driveId: string, files: File[] | FileList, options: UploadQueueFilesOptions = {}) => {
      if (!isCurrentScope()) {
        throw new Error('Uploads are unavailable during an authorization scope transition.');
      }
      const requestBoundaryKey = callbackBoundaryKey;
      const commit = (update: (current: UploadQueueItem[]) => UploadQueueItem[]) => {
        if (boundaryReadyRef.current
          && boundaryKeyRef.current === requestBoundaryKey) setItems(update);
      };
      const { resolvePath, ...uploadOptions } = options;
      const queue = Array.from(files).map(createQueueItem);
      const results: FileInfo[] = [];
      cancelledRef.current = false;
      setLoadedBoundaryKey(requestBoundaryKey);
      setItems(queue);
      setUploading(queue.length > 0);

      try {
        for (const item of queue) {
          assertUploadQueueScopeCurrent(
            boundaryKeyRef.current,
            boundaryReadyRef.current,
            requestBoundaryKey,
          );
          if (cancelledRef.current) {
            commit((current) => updateQueueItem(current, item.id, { status: 'cancelled' }));
            continue;
          }

          commit((current) => updateQueueItem(current, item.id, {
            status: 'uploading',
            progress: 0,
            error: null,
          }));

          try {
            const result = await uploader.upload(driveId, item.file, {
              ...uploadOptions,
              path: resolvePath?.(item.file) ?? uploadOptions.path,
              onProgress: (progress) => {
                if (!boundaryReadyRef.current
                  || boundaryKeyRef.current !== requestBoundaryKey) return;
                commit((current) => updateQueueItem(current, item.id, { progress }));
                uploadOptions.onProgress?.(progress);
              },
            });
            results.push(result);
            commit((current) => updateQueueItem(current, item.id, {
              status: 'complete',
              progress: 100,
              result,
            }));
          } catch (err) {
            assertUploadQueueScopeCurrent(
              boundaryKeyRef.current,
              boundaryReadyRef.current,
              requestBoundaryKey,
            );
            const cancelled = err instanceof Error && err.name === 'AbortError';
            commit((current) => updateQueueItem(current, item.id, {
              status: cancelled ? 'cancelled' : 'error',
              error: cancelled ? null : err instanceof Error ? err.message : 'Upload failed',
            }));
            if (!cancelled) throw err;
            break;
          }
        }
      } finally {
        if (boundaryReadyRef.current
          && boundaryKeyRef.current === requestBoundaryKey) setUploading(false);
      }

      assertUploadQueueScopeCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        requestBoundaryKey,
      );
      return results;
    },
    [callbackBoundaryKey, isCurrentScope, uploader.upload],
  );

  const cancel = useCallback(() => {
    if (!isCurrentScope()) return;
    cancelledRef.current = true;
    uploader.reset();
    setUploading(false);
    setItems((current) => current.map((item) =>
      item.status === 'queued' || item.status === 'uploading'
        ? { ...item, status: 'cancelled', progress: item.status === 'uploading' ? item.progress : 0 }
        : item,
    ));
  }, [isCurrentScope, uploader]);

  const clear = useCallback(() => {
    if (!isCurrentScope()) return;
    if (uploading) cancel();
    setItems([]);
  }, [cancel, isCurrentScope, uploading]);

  const completed = useMemo(() => items.filter((item) => item.status === 'complete'), [items]);
  const failed = useMemo(() => items.filter((item) => item.status === 'error'), [items]);
  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    const total = items.reduce((sum, item) => sum + item.progress, 0);
    return Math.round(total / items.length);
  }, [items]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  const visibleItems = visible ? items : [];

  return {
    items: visibleItems,
    uploading: visible ? uploading : false,
    progress: visible ? progress : 0,
    completed: visible ? completed : [],
    failed: visible ? failed : [],
    uploadFiles,
    cancel,
    clear,
  };
}

function staleUploadScopeError(): Error {
  return new Error('The authorization scope changed before the upload queue completed.');
}
