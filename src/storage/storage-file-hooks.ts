/**
 * storage-file-hooks.ts
 *
 * React hook for one storage object. This file owns UI-facing file metadata
 * state and object actions only; authenticated HTTP transport remains in the
 * SDK client and storage authorization remains in backend storage routes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OBS_CODES } from '../observability/codes';
import { emitFrontendCode } from '../frontend/client/observability';
import { useClientMaybe } from '../frontend/client/client-context';
import type { FileInfo } from './types';
import { useStorageActions } from './storage-hooks';
import { encodeStoragePath } from './storage-paths';

export interface UseStorageFileReturn {
  file: FileInfo | null;
  url: string | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  remove: () => Promise<void>;
  setVisibility: (isPublic: boolean) => Promise<void>;
}

/**
 * Load metadata and common actions for one storage file or folder.
 *
 * `driveId` and `path` may be null while a route or selection is unresolved.
 * Calls are authorized by the storage backend; this hook only coordinates
 * state and forwards mutations through the SDK-backed storage actions.
 */
export function useStorageFile(
  driveId: string | null,
  path: string | null,
): UseStorageFileReturn {
  const client = useClientMaybe();
  const actions = useStorageActions();
  const [file, setFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!client || !driveId || !path) {
      setFile(null);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    client.fetch<FileInfo>(
      `/storage/drives/${encodeURIComponent(driveId)}/info/${encodeStoragePath(path)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (requestRef.current === requestId) setFile(result);
      })
      .catch((err) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
          error: nextError,
          metadata: { action: 'loadStorageFile', driveId, path },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [client, driveId, path, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  const remove = useCallback(async () => {
    if (!driveId || !path) return;
    try {
      await actions.deleteFile(driveId, path);
      setFile(null);
    } catch (err) {
      emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
        error: err,
        metadata: { action: 'deleteStorageFile', driveId, path },
      });
      throw err;
    }
  }, [actions, driveId, path]);

  const setVisibility = useCallback(async (isPublic: boolean) => {
    if (!driveId || !path) return;
    try {
      await actions.setVisibility(driveId, isPublic, path);
      setFile((current) => current ? { ...current, isPublic } : current);
    } catch (err) {
      emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
        error: err,
        metadata: { action: 'setStorageFileVisibility', driveId, path, isPublic },
      });
      throw err;
    }
  }, [actions, driveId, path]);

  const url = useMemo(
    () => driveId && path ? actions.getFileUrl(driveId, path) : null,
    [actions, driveId, path],
  );

  return {
    file,
    url,
    loading,
    error,
    refresh,
    remove,
    setVisibility,
  };
}
