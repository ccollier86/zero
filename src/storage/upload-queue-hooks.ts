/**
 * upload-queue-hooks.ts
 *
 * Composes the single-file storage upload hook into a sequential upload queue.
 * This file owns queue UI state only; multipart transport and token refresh
 * remain inside `useUpload`.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
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

/**
 * Upload multiple files sequentially while exposing per-file progress.
 *
 * `cancel()` aborts the active upload and marks any remaining queued files as
 * cancelled.
 */
export function useUploadQueue(): UseUploadQueueReturn {
  const uploader = useUpload();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const cancelledRef = useRef(false);

  const uploadFiles = useCallback(
    async (driveId: string, files: File[] | FileList, options: UploadQueueFilesOptions = {}) => {
      const { resolvePath, ...uploadOptions } = options;
      const queue = Array.from(files).map(createQueueItem);
      const results: FileInfo[] = [];
      cancelledRef.current = false;
      setItems(queue);
      setUploading(queue.length > 0);

      try {
        for (const item of queue) {
          if (cancelledRef.current) {
            setItems((current) => updateQueueItem(current, item.id, { status: 'cancelled' }));
            continue;
          }

          setItems((current) => updateQueueItem(current, item.id, {
            status: 'uploading',
            progress: 0,
            error: null,
          }));

          try {
            const result = await uploader.upload(driveId, item.file, {
              ...uploadOptions,
              path: resolvePath?.(item.file) ?? uploadOptions.path,
              onProgress: (progress) => {
                setItems((current) => updateQueueItem(current, item.id, { progress }));
                uploadOptions.onProgress?.(progress);
              },
            });
            results.push(result);
            setItems((current) => updateQueueItem(current, item.id, {
              status: 'complete',
              progress: 100,
              result,
            }));
          } catch (err) {
            const cancelled = err instanceof Error && err.name === 'AbortError';
            setItems((current) => updateQueueItem(current, item.id, {
              status: cancelled ? 'cancelled' : 'error',
              error: cancelled ? null : err instanceof Error ? err.message : 'Upload failed',
            }));
            if (!cancelled) throw err;
            break;
          }
        }
      } finally {
        setUploading(false);
      }

      return results;
    },
    [uploader.upload],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    uploader.reset();
    setUploading(false);
    setItems((current) => current.map((item) =>
      item.status === 'queued' || item.status === 'uploading'
        ? { ...item, status: 'cancelled', progress: item.status === 'uploading' ? item.progress : 0 }
        : item,
    ));
  }, [uploader]);

  const clear = useCallback(() => {
    if (uploading) cancel();
    setItems([]);
  }, [cancel, uploading]);

  const completed = useMemo(() => items.filter((item) => item.status === 'complete'), [items]);
  const failed = useMemo(() => items.filter((item) => item.status === 'error'), [items]);
  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    const total = items.reduce((sum, item) => sum + item.progress, 0);
    return Math.round(total / items.length);
  }, [items]);

  return {
    items,
    uploading,
    progress,
    completed,
    failed,
    uploadFiles,
    cancel,
    clear,
  };
}
