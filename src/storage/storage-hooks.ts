/**
 * storage-hooks.ts
 *
 * React hooks for the storage REST API. This file owns hook state and
 * UI-facing storage actions; authenticated HTTP transport is delegated to the
 * platform SDK client instead of reading tokens from browser storage.
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  CreateUploadGrantParams,
  DriveRecord,
  DriveRecordWithAccess,
  DriveUsage,
  FileInfo,
  GrantPermissionParams,
  ListOptions,
  ListResult,
  PermissionRecord,
  StorageAccessCapabilities,
  StorageUploadGrant,
} from './types';
import { useClient } from '../frontend/client/client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
  type AuthorizationScopeBoundary,
} from '../frontend/client/authorization-scope-hooks';
import type { Client, FetchInit, InternalClient } from '../frontend/client/sdk';

// ─── Internal: SDK-backed transport ───────────────────────────────────────

function apiUrl(path: string): string {
  return `/storage${path}`;
}

function storageUrl(client: Client | null, path: string): string {
  const base = client?.url ? client.url.replace(/\/$/, '') : '';
  return `${base}${apiUrl(path)}`;
}

/** Encode each path segment individually, preserving `/` separators. */
function encodePath(path: string): string {
  const cleaned = path.startsWith('/') ? path.slice(1) : path;
  return cleaned.split('/').map(encodeURIComponent).join('/');
}

function requireStorageClient(client: Client | null): Client {
  if (!client) {
    throw new Error('Storage hooks require a platform client. Wrap your app in <AppProvider> or <ClientProvider>.');
  }
  return client;
}

function useStorageRefresh(
  boundary: AuthorizationScopeBoundary,
  setRefreshKey: Dispatch<SetStateAction<number>>,
): () => void {
  const boundaryKeyRef = useRef(boundary.key);
  const boundaryReadyRef = useRef(boundary.ready);
  boundaryKeyRef.current = boundary.key;
  boundaryReadyRef.current = boundary.ready;
  const callbackBoundaryKey = boundary.key;

  return useCallback(() => {
    if (!isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    )) return;
    setRefreshKey((key) => key + 1);
  }, [callbackBoundaryKey, setRefreshKey]);
}

function useStorageOperationGuard(boundary: AuthorizationScopeBoundary): {
  assertCurrent: () => void;
  run: <T>(operation: () => Promise<T>) => Promise<T>;
} {
  const boundaryKeyRef = useRef(boundary.key);
  const boundaryReadyRef = useRef(boundary.ready);
  boundaryKeyRef.current = boundary.key;
  boundaryReadyRef.current = boundary.ready;
  const callbackBoundaryKey = boundary.key;

  const assertCurrent = useCallback(() => {
    if (!isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    )) throw storageScopeUnavailableError();
  }, [callbackBoundaryKey]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent();
    try {
      const result = await operation();
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      throw error;
    }
  }, [assertCurrent]);

  return { assertCurrent, run };
}

async function apiFetch<T>(
  client: Client | null,
  path: string,
  init?: FetchInit,
): Promise<T> {
  return requireStorageClient(client).fetch<T>(apiUrl(path), init);
}

function parseUploadError(
  response: Pick<XMLHttpRequest, 'responseText'>,
  fallback: string,
): string {
  try {
    return JSON.parse(response.responseText)?.error || fallback;
  } catch {
    return fallback;
  }
}

function createUploadFormData(file: File, options: UploadFileOptions): FormData {
  const formData = new FormData();
  formData.append('file', file);
  if (options.path) formData.append('path', options.path);
  if (options.overwrite) formData.append('overwrite', 'true');
  if (options.public) formData.append('public', 'true');
  if (options.metadata) formData.append('metadata', JSON.stringify(options.metadata));
  return formData;
}

function createUploadAbortError(): Error {
  const error = new Error('Upload aborted');
  error.name = 'AbortError';
  return error;
}

interface UploadAttemptResult {
  status: number;
  responseText: string;
}

function sendUploadAttempt(
  client: Client,
  driveId: string,
  formData: FormData,
  options: UploadFileOptions,
  abortRef: MutableRefObject<XMLHttpRequest | null>,
  accessToken: string | null,
  assertAuthorizationScopeCurrent: () => void,
  authorizationScopeSignal: AbortSignal,
): Promise<UploadAttemptResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    abortRef.current = xhr;

    const clearCurrentRequest = () => {
      if (abortRef.current === xhr) abortRef.current = null;
      authorizationScopeSignal.removeEventListener('abort', abortForScope);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearCurrentRequest();
      reject(error);
    };
    const rejectIfScopeChanged = (): boolean => {
      try {
        assertAuthorizationScopeCurrent();
        return false;
      } catch (error) {
        rejectOnce(error);
        xhr.abort();
        return true;
      }
    };
    const abortForScope = () => {
      const reason = authorizationScopeSignal.reason instanceof Error
        ? authorizationScopeSignal.reason
        : createUploadAbortError();
      rejectOnce(reason);
      xhr.abort();
    };

    authorizationScopeSignal.addEventListener('abort', abortForScope, { once: true });

    xhr.upload.onprogress = (e) => {
      if (rejectIfScopeChanged()) return;
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        options.onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (rejectIfScopeChanged() || settled) return;
      settled = true;
      clearCurrentRequest();
      resolve({ status: xhr.status, responseText: xhr.responseText });
    };

    xhr.onerror = () => {
      rejectOnce(new Error('Network error'));
    };

    xhr.onabort = () => {
      rejectOnce(createUploadAbortError());
    };

    xhr.open('POST', storageUrl(client, `/drives/${driveId}/upload`));
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    if (authorizationScopeSignal.aborted) {
      abortForScope();
      return;
    }
    if (rejectIfScopeChanged()) return;
    xhr.send(formData);
  });
}

/** @internal Behavioral transport seam used by storage regression tests. */
export async function sendUploadRequest(
  client: Client,
  driveId: string,
  formData: FormData,
  options: UploadFileOptions,
  abortRef: MutableRefObject<XMLHttpRequest | null>,
): Promise<FileInfo> {
  const auth = (client as InternalClient).auth;
  const executeAttempt = (
    accessToken: string | null,
    assertCurrent: () => void,
    authorizationScopeSignal = new AbortController().signal,
  ) => sendUploadAttempt(
    client,
    driveId,
    formData,
    options,
    abortRef,
    accessToken,
    assertCurrent,
    authorizationScopeSignal,
  );
  const response = auth
    ? await auth.requestWithAuthTransport(executeAttempt)
    : await executeAttempt(null, () => {});

  if (response.status >= 200 && response.status < 300) {
    try {
      return JSON.parse(response.responseText) as FileInfo;
    } catch {
      throw new Error('Invalid response');
    }
  }

  throw new Error(parseUploadError(response, 'Upload failed'));
}

// ─── useUpload ───────────────────────────────────────────────────────────

export interface UploadState {
  uploading: boolean;
  progress: number;
  error: string | null;
  result: FileInfo | null;
}

export interface UseUploadReturn extends UploadState {
  upload: (driveId: string, file: File, options?: UploadFileOptions) => Promise<FileInfo>;
  reset: () => void;
}

export interface UploadFileOptions {
  path?: string;
  overwrite?: boolean;
  public?: boolean;
  metadata?: Record<string, unknown>;
  onProgress?: (progress: number) => void;
}

/**
 * Upload files to a storage drive with XHR progress reporting.
 *
 * Uses the SDK's authenticated transport lifecycle so stored-session
 * restoration, one 401 refresh/retry, and authorization-scope fencing match
 * `client.fetch()` without exposing credential handling to the hook.
 */
export function useUpload(): UseUploadReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
    result: null,
  });
  const abortRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
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

  // Abort in-flight XHR on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // A transition masks prior results immediately and aborts the current XHR.
  // The transport epoch remains the authoritative race fence if XHR completes
  // before React has run this cleanup effect.
  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoadedBoundaryKey(authorizationBoundary.key);
    setState({ uploading: false, progress: 0, error: null, result: null });
  }, [authorizationBoundary.key]);

  const upload = useCallback(
    async (driveId: string, file: File, options: UploadFileOptions = {}): Promise<FileInfo> => {
      if (!isCurrentScope()) throw storageScopeUnavailableError();
      const requestBoundaryKey = callbackBoundaryKey;
      setLoadedBoundaryKey(requestBoundaryKey);
      setState({ uploading: true, progress: 0, error: null, result: null });

      try {
        const sdkClient = requireStorageClient(client);
        const result = await sendUploadRequest(
          sdkClient,
          driveId,
          createUploadFormData(file, options),
          {
            ...options,
            onProgress: (progress) => {
              if (mountedRef.current && boundaryKeyRef.current === requestBoundaryKey) {
                setState((s) => ({ ...s, progress }));
                options.onProgress?.(progress);
              }
            },
          },
          abortRef,
        );
        if (!mountedRef.current
          || !boundaryReadyRef.current
          || boundaryKeyRef.current !== requestBoundaryKey) {
          throw new Error('The authorization scope changed before the upload completed.');
        }
        setState({ uploading: false, progress: 100, error: null, result });
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (mountedRef.current && boundaryKeyRef.current === requestBoundaryKey) {
            setState({ uploading: false, progress: 0, error: null, result: null });
          }
          throw err;
        }

        const message = err instanceof Error ? err.message : 'Upload failed';
        if (mountedRef.current && boundaryKeyRef.current === requestBoundaryKey) {
          setState((s) => ({ ...s, uploading: false, error: message }));
        }
        throw err;
      }
    },
    [callbackBoundaryKey, client, isCurrentScope]
  );

  const reset = useCallback(() => {
    if (!isCurrentScope()) return;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState({ uploading: false, progress: 0, error: null, result: null });
  }, [isCurrentScope]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    uploading: visible ? state.uploading : false,
    progress: visible ? state.progress : 0,
    error: visible ? state.error : null,
    result: visible ? state.result : null,
    upload,
    reset,
  };
}

// ─── useStorageFolder ────────────────────────────────────────────────────

export interface UseStorageFolderReturn {
  items: FileInfo[];
  total: number;
  cursor: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface UseStorageFolderOptions extends ListOptions {}

/**
 * Load one folder listing from the storage API.
 *
 * Requests go through `client.fetch()` so Authorization headers and refresh
 * retry behavior match the rest of the SDK.
 */
export function useStorageFolder(
  driveId: string | null,
  path?: string,
  options: UseStorageFolderOptions = {},
): UseStorageFolderReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [items, setItems] = useState<FileInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const {
    cursor: requestedCursor,
    limit,
    sortBy,
    sortDir,
    type,
  } = options;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setItems([]);
    setTotal(0);
    setCursor(null);
    setError(null);
    if (!driveId || !client || !authorizationBoundary.ready) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoading(true);

    const query = new URLSearchParams();
    if (path) query.set('path', path);
    if (requestedCursor) query.set('cursor', requestedCursor);
    if (limit) query.set('limit', String(limit));
    if (sortBy) query.set('sortBy', sortBy);
    if (sortDir) query.set('sortDir', sortDir);
    if (type) query.set('type', type);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    apiFetch<ListResult>(client, `/drives/${driveId}/list${queryString}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
        setCursor(result.cursor);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    driveId,
    limit,
    path,
    refreshKey,
    requestedCursor,
    sortBy,
    sortDir,
    type,
  ]);

  const refresh = useStorageRefresh(authorizationBoundary, setRefreshKey);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    items: visible ? items : [],
    total: visible ? total : 0,
    cursor: visible ? cursor : null,
    loading: visible ? loading : Boolean(driveId && authorizationBoundary.ready),
    error: visible ? error : null,
    refresh,
  };
}

// ─── useStorageDrives ────────────────────────────────────────────────────

export interface UseStorageDrivesReturn {
  drives: DriveRecordWithAccess[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Load the drive list visible to the current user.
 *
 * Anonymous clients receive public drives; authenticated clients include their
 * private and permission-granted drives through SDK auth headers.
 */
export function useStorageDrives(): UseStorageDrivesReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [drives, setDrives] = useState<DriveRecordWithAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setDrives([]);
    setError(null);

    if (!client || !authorizationBoundary.ready) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoading(true);
    apiFetch<DriveRecordWithAccess[]>(client, '/drives', { signal: controller.signal })
      .then((result) => {
        if (active) setDrives(result);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [authorizationBoundary.key, authorizationBoundary.ready, client, refreshKey]);

  const refresh = useStorageRefresh(authorizationBoundary, setRefreshKey);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    drives: visible ? drives : [],
    loading: visible ? loading : authorizationBoundary.ready,
    error: visible ? error : null,
    refresh,
  };
}

// ─── useDriveCapabilities ────────────────────────────────────────────────

export interface UseDriveCapabilitiesReturn {
  capabilities: StorageAccessCapabilities | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Load current-user storage capabilities for a drive or object path. */
export function useDriveCapabilities(
  driveId: string | null,
  path?: string,
): UseDriveCapabilitiesReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [capabilities, setCapabilities] = useState<StorageAccessCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setCapabilities(null);
    setError(null);
    if (!driveId || !client || !authorizationBoundary.ready) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    const query = new URLSearchParams();
    if (path) query.set('path', path);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    setLoading(true);
    apiFetch<StorageAccessCapabilities>(
      client,
      `/drives/${driveId}/capabilities${queryString}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (active) setCapabilities(result);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError') {
          setCapabilities(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    driveId,
    path,
    refreshKey,
  ]);

  const refresh = useStorageRefresh(authorizationBoundary, setRefreshKey);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    capabilities: visible ? capabilities : null,
    loading: visible ? loading : Boolean(driveId && authorizationBoundary.ready),
    error: visible ? error : null,
    refresh,
  };
}

// ─── useStoragePermissions ───────────────────────────────────────────────

export interface UseStoragePermissionsReturn {
  permissions: PermissionRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Load drive-level or object-relevant storage permissions. */
export function useStoragePermissions(
  driveId: string | null,
  objectPath?: string,
): UseStoragePermissionsReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setPermissions([]);
    setError(null);
    if (!driveId || !client || !authorizationBoundary.ready) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    const query = new URLSearchParams();
    if (objectPath) query.set('objectPath', objectPath);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    setLoading(true);
    apiFetch<{ permissions: PermissionRecord[] }>(
      client,
      `/drives/${driveId}/permissions${queryString}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (active) setPermissions(result.permissions);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError') {
          setPermissions([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    driveId,
    objectPath,
    refreshKey,
  ]);

  const refresh = useStorageRefresh(authorizationBoundary, setRefreshKey);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    permissions: visible ? permissions : [],
    loading: visible ? loading : Boolean(driveId && authorizationBoundary.ready),
    error: visible ? error : null,
    refresh,
  };
}

// ─── useDriveUsage ───────────────────────────────────────────────────────

export interface UseDriveUsageReturn {
  usage: DriveUsage | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Load usage statistics for one drive using the SDK-authenticated transport.
 */
export function useDriveUsage(driveId: string | null): UseDriveUsageReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setUsage(null);
    setError(null);
    if (!driveId || !client || !authorizationBoundary.ready) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoading(true);

    apiFetch<DriveUsage>(client, `/drives/${driveId}/usage`, { signal: controller.signal })
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError') {
          setUsage(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    driveId,
    refreshKey,
  ]);

  const refresh = useStorageRefresh(authorizationBoundary, setRefreshKey);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    usage: visible ? usage : null,
    loading: visible ? loading : Boolean(driveId && authorizationBoundary.ready),
    error: visible ? error : null,
    refresh,
  };
}

// ─── usePresignedUrl ─────────────────────────────────────────────────────

export interface UsePresignedUrlReturn {
  getUrl: (driveId: string, path: string, method?: 'upload' | 'download') => Promise<string>;
}

/**
 * Create presigned storage URLs through the authenticated SDK client.
 */
export function usePresignedUrl(): UsePresignedUrlReturn {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const scope = useStorageOperationGuard(authorizationBoundary);
  const getUrl = useCallback(
    async (driveId: string, path: string, method: 'upload' | 'download' = 'download') => {
      const result = await scope.run(() => apiFetch<{ token: string }>(
        client,
        `/drives/${driveId}/presign`,
        {
          method: 'POST',
          body: { path, method },
        },
      ));
      return storageUrl(client, `/presigned/${result.token}`);
    },
    [client, scope]
  );

  return { getUrl };
}

// ─── useStorageActions ───────────────────────────────────────────────────

export interface StorageActions {
  createDrive: (name: string, options?: { maxSize?: number; maxFileSize?: number; allowedMimeTypes?: string[]; public?: boolean }) => Promise<DriveRecord>;
  updateDrive: (driveId: string, updates: { name?: string; maxSize?: number; maxFileSize?: number; allowedMimeTypes?: string[] }) => Promise<DriveRecord>;
  deleteDrive: (driveId: string) => Promise<void>;
  grantPermission: (driveId: string, params: GrantPermissionParams) => Promise<PermissionRecord>;
  revokePermission: (permissionId: string) => Promise<void>;
  createUploadGrant: (driveId: string, params: CreateUploadGrantParams) => Promise<StorageUploadGrant>;
  createFolder: (driveId: string, path: string, isPublic?: boolean) => Promise<FileInfo>;
  deleteFile: (driveId: string, path: string) => Promise<void>;
  moveFile: (driveId: string, from: string, to: string) => Promise<FileInfo>;
  copyFile: (driveId: string, from: string, to: string) => Promise<FileInfo>;
  setVisibility: (driveId: string, isPublic: boolean, path?: string) => Promise<void>;
  getFileUrl: (driveId: string, path: string) => string;
}

/**
 * Return storage mutation helpers backed by the SDK authenticated HTTP client.
 */
export function useStorageActions(): StorageActions {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const scope = useStorageOperationGuard(authorizationBoundary);

  return {
    createDrive: useCallback(async (name, options) => {
      return scope.run(() => apiFetch<DriveRecord>(client, '/drives', {
        method: 'POST',
        body: { name, ...options },
      }));
    }, [client, scope]),

    updateDrive: useCallback(async (driveId, updates) => {
      return scope.run(() => apiFetch<DriveRecord>(client, `/drives/${driveId}`, {
        method: 'PATCH',
        body: updates,
      }));
    }, [client, scope]),

    deleteDrive: useCallback(async (driveId) => {
      await scope.run(() => apiFetch(client, `/drives/${driveId}`, { method: 'DELETE' }));
    }, [client, scope]),

    grantPermission: useCallback(async (driveId, params) => {
      return scope.run(() => apiFetch<PermissionRecord>(client, `/drives/${driveId}/permissions`, {
        method: 'POST',
        body: params,
      }));
    }, [client, scope]),

    revokePermission: useCallback(async (permissionId) => {
      await scope.run(() => apiFetch(client, `/permissions/${permissionId}`, { method: 'DELETE' }));
    }, [client, scope]),

    createUploadGrant: useCallback(async (driveId, params) => {
      return scope.run(() => apiFetch<StorageUploadGrant>(client, `/drives/${driveId}/upload-grants`, {
        method: 'POST',
        body: params,
      }));
    }, [client, scope]),

    createFolder: useCallback(async (driveId, path, isPublic) => {
      return scope.run(() => apiFetch<FileInfo>(client, `/drives/${driveId}/folders`, {
        method: 'POST',
        body: { path, public: isPublic },
      }));
    }, [client, scope]),

    deleteFile: useCallback(async (driveId, path) => {
      const encoded = encodePath(path);
      await scope.run(() => apiFetch(
        client,
        `/drives/${driveId}/files/${encoded}`,
        { method: 'DELETE' },
      ));
    }, [client, scope]),

    moveFile: useCallback(async (driveId, from, to) => {
      return scope.run(() => apiFetch<FileInfo>(client, `/drives/${driveId}/move`, {
        method: 'POST',
        body: { from, to },
      }));
    }, [client, scope]),

    copyFile: useCallback(async (driveId, from, to) => {
      return scope.run(() => apiFetch<FileInfo>(client, `/drives/${driveId}/copy`, {
        method: 'POST',
        body: { from, to },
      }));
    }, [client, scope]),

    setVisibility: useCallback(async (driveId, isPublic, path) => {
      await scope.run(() => apiFetch(client, `/drives/${driveId}/visibility`, {
        method: 'PATCH',
        body: { public: isPublic, path },
      }));
    }, [client, scope]),

    getFileUrl: useCallback((driveId: string, path: string) => {
      scope.assertCurrent();
      const encoded = encodePath(path);
      return storageUrl(client, `/drives/${driveId}/files/${encoded}`);
    }, [client, scope]),
  };
}

function storageScopeUnavailableError(): Error {
  return new Error('Storage operations are unavailable during an authorization scope transition.');
}
