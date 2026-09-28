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
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../frontend/client/authorization-scope-hooks';
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
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const actions = useStorageActions();
  const [file, setFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const requestRef = useRef(0);
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
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setFile(null);
    setError(null);
    if (!client || !driveId || !path || !authorizationBoundary.ready) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);

    client.fetch<FileInfo>(
      `/storage/drives/${encodeURIComponent(driveId)}/info/${encodeStoragePath(path)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (requestRef.current === requestId
          && boundaryReadyRef.current
          && boundaryKeyRef.current === authorizationBoundary.key) setFile(result);
      })
      .catch((err) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || !boundaryReadyRef.current
          || boundaryKeyRef.current !== authorizationBoundary.key) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
          error: nextError,
          metadata: { action: 'loadStorageFile', driveId, path },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted
          && requestRef.current === requestId
          && boundaryReadyRef.current
          && boundaryKeyRef.current === authorizationBoundary.key) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    driveId,
    path,
    refreshKey,
  ]);

  const refresh = useCallback(() => {
    if (!isCurrentScope()) return;
    setRefreshKey((current) => current + 1);
  }, [isCurrentScope]);

  const remove = useCallback(async () => {
    if (!driveId || !path || !isCurrentScope()) return;
    const requestBoundaryKey = callbackBoundaryKey;
    try {
      await actions.deleteFile(driveId, path);
      if (boundaryReadyRef.current
        && boundaryKeyRef.current === requestBoundaryKey) setFile(null);
    } catch (err) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw err;
      emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
        error: err,
        metadata: { action: 'deleteStorageFile', driveId, path },
      });
      throw err;
    }
  }, [actions, callbackBoundaryKey, driveId, isCurrentScope, path]);

  const setVisibility = useCallback(async (isPublic: boolean) => {
    if (!driveId || !path || !isCurrentScope()) return;
    const requestBoundaryKey = callbackBoundaryKey;
    try {
      await actions.setVisibility(driveId, isPublic, path);
      if (boundaryReadyRef.current
        && boundaryKeyRef.current === requestBoundaryKey) {
        setFile((current) => current ? { ...current, isPublic } : current);
      }
    } catch (err) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw err;
      emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
        error: err,
        metadata: { action: 'setStorageFileVisibility', driveId, path, isPublic },
      });
      throw err;
    }
  }, [actions, callbackBoundaryKey, driveId, isCurrentScope, path]);

  const url = useMemo(
    () => authorizationBoundary.ready && driveId && path
      ? actions.getFileUrl(driveId, path)
      : null,
    [actions, authorizationBoundary.ready, driveId, path],
  );

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;

  return {
    file: visible ? file : null,
    url: visible ? url : null,
    loading: visible ? loading : Boolean(client && driveId && path && authorizationBoundary.ready),
    error: visible ? error : null,
    refresh,
    remove,
    setVisibility,
  };
}
