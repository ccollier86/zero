/**
 * storage-hooks.ts
 *
 * React hooks for the storage REST API. This file owns hook state and
 * UI-facing storage actions; authenticated HTTP transport is delegated to the
 * platform SDK client instead of reading tokens from browser storage.
 */

import { useState, useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { FileInfo, ListResult, DriveUsage, DriveRecord } from './types';
import { useClient } from '../frontend/client/client-context';
import type { Client, FetchInit } from '../frontend/client/sdk';

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

async function apiFetch<T>(
  client: Client | null,
  path: string,
  init?: FetchInit,
): Promise<T> {
  return requireStorageClient(client).fetch<T>(apiUrl(path), init);
}

function parseUploadError(xhr: XMLHttpRequest, fallback: string): string {
  try {
    return JSON.parse(xhr.responseText)?.error || fallback;
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

function sendUploadRequest(
  client: Client,
  driveId: string,
  formData: FormData,
  options: UploadFileOptions,
  abortRef: MutableRefObject<XMLHttpRequest | null>,
  retryOnUnauthorized: boolean,
): Promise<FileInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    abortRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        options.onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      abortRef.current = null;

      if (xhr.status === 401 && retryOnUnauthorized) {
        client.refresh()
          .then(() => sendUploadRequest(
            client,
            driveId,
            formData,
            options,
            abortRef,
            false,
          ))
          .then(resolve, reject);
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileInfo);
        } catch {
          reject(new Error('Invalid response'));
        }
        return;
      }

      reject(new Error(parseUploadError(xhr, 'Upload failed')));
    };

    xhr.onerror = () => {
      abortRef.current = null;
      reject(new Error('Network error'));
    };

    xhr.onabort = () => {
      abortRef.current = null;
      reject(createUploadAbortError());
    };

    xhr.open('POST', storageUrl(client, `/drives/${driveId}/upload`));
    if (client.token) xhr.setRequestHeader('Authorization', `Bearer ${client.token}`);
    xhr.send(formData);
  });
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
 * Uses the SDK client's in-memory access token and retries once after
 * `client.refresh()` if the upload receives 401.
 */
export function useUpload(): UseUploadReturn {
  const client = useClient();
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
    result: null,
  });
  const abortRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);

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

  const upload = useCallback(
    async (driveId: string, file: File, options: UploadFileOptions = {}): Promise<FileInfo> => {
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
              if (mountedRef.current) setState((s) => ({ ...s, progress }));
              options.onProgress?.(progress);
            },
          },
          abortRef,
          true,
        );
        if (mountedRef.current) setState({ uploading: false, progress: 100, error: null, result });
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (mountedRef.current) {
            setState({ uploading: false, progress: 0, error: null, result: null });
          }
          throw err;
        }

        const message = err instanceof Error ? err.message : 'Upload failed';
        if (mountedRef.current) setState((s) => ({ ...s, uploading: false, error: message }));
        throw err;
      }
    },
    [client]
  );

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState({ uploading: false, progress: 0, error: null, result: null });
  }, []);

  return { ...state, upload, reset };
}

// ─── useStorageFolder ────────────────────────────────────────────────────

export interface UseStorageFolderReturn {
  items: FileInfo[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Load one folder listing from the storage API.
 *
 * Requests go through `client.fetch()` so Authorization headers and refresh
 * retry behavior match the rest of the SDK.
 */
export function useStorageFolder(driveId: string | null, path?: string): UseStorageFolderReturn {
  const client = useClient();
  const [items, setItems] = useState<FileInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!driveId || !client) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    apiFetch<ListResult>(client, `/drives/${driveId}/list${query}`, { signal: controller.signal })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [client, driveId, path, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { items, total, loading, error, refresh };
}

// ─── useStorageDrives ────────────────────────────────────────────────────

export interface UseStorageDrivesReturn {
  drives: DriveRecord[];
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
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    if (!client) {
      setLoading(false);
      return () => controller.abort();
    }

    apiFetch<DriveRecord[]>(client, '/drives', { signal: controller.signal })
      .then(setDrives)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [client, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { drives, loading, error, refresh };
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
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!driveId || !client) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiFetch<DriveUsage>(client, `/drives/${driveId}/usage`, { signal: controller.signal })
      .then(setUsage)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [client, driveId, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { usage, loading, error, refresh };
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
  const getUrl = useCallback(
    async (driveId: string, path: string, method: 'upload' | 'download' = 'download') => {
      const result = await apiFetch<{ token: string }>(client, `/drives/${driveId}/presign`, {
        method: 'POST',
        body: { path, method },
      });
      return storageUrl(client, `/presigned/${result.token}`);
    },
    [client]
  );

  return { getUrl };
}

// ─── useStorageActions ───────────────────────────────────────────────────

export interface StorageActions {
  createDrive: (name: string, options?: { maxSize?: number; maxFileSize?: number; allowedMimeTypes?: string[]; public?: boolean }) => Promise<DriveRecord>;
  updateDrive: (driveId: string, updates: { name?: string; maxSize?: number; maxFileSize?: number; allowedMimeTypes?: string[] }) => Promise<DriveRecord>;
  deleteDrive: (driveId: string) => Promise<void>;
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

  return {
    createDrive: useCallback(async (name, options) => {
      return apiFetch<DriveRecord>(client, '/drives', {
        method: 'POST',
        body: { name, ...options },
      });
    }, [client]),

    updateDrive: useCallback(async (driveId, updates) => {
      return apiFetch<DriveRecord>(client, `/drives/${driveId}`, {
        method: 'PATCH',
        body: updates,
      });
    }, [client]),

    deleteDrive: useCallback(async (driveId) => {
      await apiFetch(client, `/drives/${driveId}`, { method: 'DELETE' });
    }, [client]),

    createFolder: useCallback(async (driveId, path, isPublic) => {
      return apiFetch<FileInfo>(client, `/drives/${driveId}/folders`, {
        method: 'POST',
        body: { path, public: isPublic },
      });
    }, [client]),

    deleteFile: useCallback(async (driveId, path) => {
      const encoded = encodePath(path);
      await apiFetch(client, `/drives/${driveId}/files/${encoded}`, { method: 'DELETE' });
    }, [client]),

    moveFile: useCallback(async (driveId, from, to) => {
      return apiFetch<FileInfo>(client, `/drives/${driveId}/move`, {
        method: 'POST',
        body: { from, to },
      });
    }, [client]),

    copyFile: useCallback(async (driveId, from, to) => {
      return apiFetch<FileInfo>(client, `/drives/${driveId}/copy`, {
        method: 'POST',
        body: { from, to },
      });
    }, [client]),

    setVisibility: useCallback(async (driveId, isPublic, path) => {
      await apiFetch(client, `/drives/${driveId}/visibility`, {
        method: 'PATCH',
        body: { public: isPublic, path },
      });
    }, [client]),

    getFileUrl: useCallback((driveId: string, path: string) => {
      const encoded = encodePath(path);
      return storageUrl(client, `/drives/${driveId}/files/${encoded}`);
    }, [client]),
  };
}
