/**
 * storage-browser-hooks.ts
 *
 * Composes storage folder, action, quota, and upload hooks into app-ready file
 * browser state. This file owns browser UI state only; storage authorization
 * and authenticated HTTP transport remain in storage routes and SDK-backed hooks.
 */

import { useCallback, useMemo, useState } from 'react';
import { OBS_CODES } from '../observability/codes';
import { emitFrontendCode } from '../frontend/client/observability';
import type { DriveUsage, FileInfo } from './types';
import {
  useDriveUsage,
  useStorageActions,
  useStorageFolder,
} from './storage-hooks';
import { joinStorageObjectPath } from './storage-paths';
import { useUploadQueue, type UploadQueueFilesOptions, type UseUploadQueueReturn } from './upload-queue-hooks';

export interface StorageBrowserActions {
  openFolder: (folder: FileInfo | string) => void;
  goUp: () => void;
  setPath: (path: string) => void;
  select: (item: FileInfo | null) => void;
  uploadFiles: (files: File[] | FileList, options?: UploadQueueFilesOptions) => Promise<FileInfo[]>;
  createFolder: (name: string, isPublic?: boolean) => Promise<FileInfo | null>;
  deleteSelected: () => Promise<void>;
  moveSelected: (to: string) => Promise<FileInfo | null>;
  copySelected: (to: string) => Promise<FileInfo | null>;
  refresh: () => void;
}

export interface UseStorageBrowserReturn extends StorageBrowserActions {
  driveId: string | null;
  path: string;
  isRoot: boolean;
  items: FileInfo[];
  selected: FileInfo | null;
  total: number;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  uploadQueue: UseUploadQueueReturn;
}

export interface UseDriveQuotaReturn {
  usage: DriveUsage | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  percentUsed: number;
  unlimited: boolean;
  overLimit: boolean;
  nearLimit: boolean;
}

function cleanPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function joinPath(base: string, child: string): string {
  const cleanedBase = cleanPath(base);
  const cleanedChild = cleanPath(child);
  if (!cleanedBase) return cleanedChild;
  if (!cleanedChild) return cleanedBase;
  return `${cleanedBase}/${cleanedChild}`;
}

function parentPath(path: string): string {
  const parts = cleanPath(path).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

/**
 * Compose one drive/folder browser state object for storage UI components.
 *
 * The hook keeps selected file, current path, upload queue, and common file
 * actions together while delegating all storage operations to SDK-backed hooks.
 */
export function useStorageBrowser(
  driveId: string | null,
  initialPath = '',
): UseStorageBrowserReturn {
  const [path, setPathState] = useState(cleanPath(initialPath));
  const [selected, setSelected] = useState<FileInfo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const folder = useStorageFolder(driveId, path);
  const actions = useStorageActions();
  const uploadQueue = useUploadQueue();

  const runStorageAction = useCallback(
    async <T,>(name: string, action: () => Promise<T>): Promise<T | null> => {
      if (!driveId) return null;
      setActionError(null);
      try {
        const result = await action();
        folder.refresh();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Storage action failed';
        setActionError(message);
        emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
          error: err,
          metadata: { action: name, driveId, path },
        });
        throw err;
      }
    },
    [driveId, folder.refresh, path],
  );

  const openFolder = useCallback((folderOrPath: FileInfo | string) => {
    const nextPath = typeof folderOrPath === 'string'
      ? folderOrPath
      : folderOrPath.path;
    setPathState(cleanPath(nextPath));
    setSelected(null);
  }, []);

  const setPath = useCallback((nextPath: string) => {
    setPathState(cleanPath(nextPath));
    setSelected(null);
  }, []);

  const goUp = useCallback(() => {
    setPathState((current) => parentPath(current));
    setSelected(null);
  }, []);

  const uploadFiles = useCallback(
    async (files: File[] | FileList, options: UploadQueueFilesOptions = {}) => {
      if (!driveId) return [];
      const { resolvePath, ...uploadOptions } = options;
      const targetFolder = uploadOptions.path ?? path;
      const result = await runStorageAction('uploadFiles', () =>
        uploadQueue.uploadFiles(driveId, files, {
          ...uploadOptions,
          resolvePath: (file) =>
            resolvePath?.(file)
            ?? joinStorageObjectPath(targetFolder, file.name),
        }));
      return result ?? [];
    },
    [driveId, path, runStorageAction, uploadQueue],
  );

  const createFolder = useCallback(
    async (name: string, isPublic?: boolean) => {
      const result = await runStorageAction('createFolder', () =>
        actions.createFolder(driveId!, joinPath(path, name), isPublic));
      return result;
    },
    [actions, driveId, path, runStorageAction],
  );

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    await runStorageAction('deleteSelected', () => actions.deleteFile(selected.driveId, selected.path));
    setSelected(null);
  }, [actions, runStorageAction, selected]);

  const moveSelected = useCallback(
    async (to: string) => {
      if (!selected) return null;
      const result = await runStorageAction('moveSelected', () =>
        actions.moveFile(selected.driveId, selected.path, to));
      setSelected(result);
      return result;
    },
    [actions, runStorageAction, selected],
  );

  const copySelected = useCallback(
    async (to: string) => {
      if (!selected) return null;
      return runStorageAction('copySelected', () =>
        actions.copyFile(selected.driveId, selected.path, to));
    },
    [actions, runStorageAction, selected],
  );

  const refresh = useCallback(() => {
    folder.refresh();
  }, [folder.refresh]);

  return useMemo(
    () => ({
      driveId,
      path,
      isRoot: path.length === 0,
      items: folder.items,
      selected,
      total: folder.total,
      loading: folder.loading,
      error: folder.error,
      actionError,
      uploadQueue,
      openFolder,
      goUp,
      setPath,
      select: setSelected,
      uploadFiles,
      createFolder,
      deleteSelected,
      moveSelected,
      copySelected,
      refresh,
    }),
    [
      actionError,
      copySelected,
      createFolder,
      deleteSelected,
      driveId,
      folder.error,
      folder.items,
      folder.loading,
      folder.total,
      goUp,
      moveSelected,
      openFolder,
      path,
      refresh,
      selected,
      setPath,
      uploadFiles,
      uploadQueue,
    ],
  );
}

/**
 * Load drive quota and derive common limit flags for UI display.
 */
export function useDriveQuota(driveId: string | null): UseDriveQuotaReturn {
  const usage = useDriveUsage(driveId);

  return useMemo(
    () => ({
      ...usage,
      percentUsed: usage.usage?.percentUsed ?? 0,
      unlimited: !usage.usage || usage.usage.maxBytes <= 0,
      overLimit: !!usage.usage && usage.usage.maxBytes > 0 && usage.usage.totalBytes > usage.usage.maxBytes,
      nearLimit: !!usage.usage && usage.usage.maxBytes > 0 && usage.usage.percentUsed >= 80,
    }),
    [usage],
  );
}
