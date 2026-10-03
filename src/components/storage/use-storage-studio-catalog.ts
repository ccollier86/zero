'use client';

/**
 * use-storage-studio-catalog.ts
 *
 * Owns authorization-fenced Storage Studio capabilities, catalog reads, and
 * cursor navigation. Selection, object browsing, mutations, and rendering
 * remain in focused peers.
 */

import * as React from 'react';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
} from '../../storage/storage-studio-contracts';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type { StorageStudioPagination } from './storage-management-controller';
import { reportStorageActionError } from './storage-observability';

export interface UseStorageStudioCatalogInput {
  readonly surface: StorageStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly request: Omit<StorageStudioDriveListRequest, 'cursor' | 'limit'>;
  readonly pageSize: number;
}

export interface UseStorageStudioCatalogResult {
  readonly capabilities: StorageStudioCapabilities | null;
  readonly drives: readonly StorageStudioDrive[];
  readonly pagination: StorageStudioPagination;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly error: Error | null;
  readonly refresh: () => void;
  readonly previousPage: () => void;
  readonly nextPage: () => void;
  readonly upsertDrive: (drive: StorageStudioDrive) => void;
  readonly removeDrive: (driveId: string) => void;
}

const EMPTY_PAGE: StorageStudioDrivePage = Object.freeze({
  items: Object.freeze([]),
  page: Object.freeze({ limit: 50, count: 0, hasMore: false, nextCursor: null }),
});

/** Load the managed-drive catalog for one immutable Guardian scope. */
export function useStorageStudioCatalog(
  input: UseStorageStudioCatalogInput,
): UseStorageStudioCatalogResult {
  const requestKey = JSON.stringify(input.request);
  const navigationKey = `${input.boundary.key}\0${requestKey}`;
  const [capabilities, setCapabilities] = React.useState<StorageStudioCapabilities | null>(null);
  const [page, setPage] = React.useState<StorageStudioDrivePage>(EMPTY_PAGE);
  const [navigation, setNavigation] = React.useState<Readonly<{
    key: string;
    cursor: string | null;
    history: readonly (string | null)[];
  }>>(() => Object.freeze({ key: navigationKey, cursor: null, history: Object.freeze([]) }));
  const cursor = navigation.key === navigationKey ? navigation.cursor : null;
  const cursorHistory = navigation.key === navigationKey
    ? navigation.history
    : Object.freeze([] as (string | null)[]);
  const [loading, setLoading] = React.useState(false);
  const [disabled, setDisabled] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const [loadedRequestKey, setLoadedRequestKey] = React.useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = React.useState(0);
  const requestId = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const boundaryKeyRef = React.useRef(input.boundary.key);
  const boundaryReadyRef = React.useRef(input.boundary.ready);
  const catalogRequestRef = React.useRef(input.request);
  boundaryKeyRef.current = input.boundary.key;
  boundaryReadyRef.current = input.boundary.ready;
  catalogRequestRef.current = input.request;
  const catalogRequestKey = `${input.boundary.key}\0${requestKey}\0${cursor ?? ''}\0${input.pageSize}`;
  const catalogRequestKeyRef = React.useRef(catalogRequestKey);
  catalogRequestKeyRef.current = catalogRequestKey;
  const scopeAvailable = input.enabled
    && input.authenticated
    && input.boundary.ready
    && Boolean(input.surface);

  React.useEffect(() => {
    setNavigation(Object.freeze({
      key: navigationKey,
      cursor: null,
      history: Object.freeze([]),
    }));
  }, [navigationKey]);

  React.useEffect(() => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const capturedBoundaryKey = input.boundary.key;
    const capturedRequestKey = catalogRequestKey;
    const available = scopeAvailable;

    setLoadedRequestKey(capturedRequestKey);
    setCapabilities(null);
    setPage({ ...EMPTY_PAGE, page: { ...EMPTY_PAGE.page, limit: input.pageSize } });
    setError(null);
    setDisabled(!input.enabled);
    if (!available || !input.surface) {
      setLoading(false);
      return () => controller.abort();
    }

    input.surface.setScope(capturedBoundaryKey);
    setLoading(true);
    void (async () => {
      try {
        const nextCapabilities = await input.surface!.getCapabilities({ signal: controller.signal });
        if (!isCurrent()) return;
        setCapabilities(nextCapabilities);
        setDisabled(false);
        if (!nextCapabilities.canReadCatalog && !nextCapabilities.canProvisionPersonal) {
          setPage({ ...EMPTY_PAGE, page: { ...EMPTY_PAGE.page, limit: input.pageSize } });
          return;
        }
        const nextPage = await input.surface!.listDrives({
          ...catalogRequestRef.current,
          ...(cursor ? { cursor } : {}),
          limit: input.pageSize,
        }, { signal: controller.signal });
        if (isCurrent()) setPage(nextPage);
      } catch (cause) {
        if (controller.signal.aborted || !isCurrent()) return;
        const nextError = toError(cause);
        if (isStudioDisabled(cause)) {
          setDisabled(true);
          setCapabilities(null);
          setPage({ ...EMPTY_PAGE, page: { ...EMPTY_PAGE.page, limit: input.pageSize } });
        } else {
          setError(nextError);
          reportStorageActionError('studioCatalogLoad', nextError);
        }
      } finally {
        if (isCurrent()) setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();

    return () => {
      requestId.current += 1;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };

    function isCurrent(): boolean {
      return id === requestId.current
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedBoundaryKey
        && catalogRequestKeyRef.current === capturedRequestKey;
    }
  }, [
    cursor,
    input.authenticated,
    input.boundary.key,
    input.boundary.ready,
    input.enabled,
    input.pageSize,
    requestKey,
    input.surface,
    catalogRequestKey,
    refreshRevision,
    scopeAvailable,
  ]);

  const refresh = React.useCallback(() => {
    if (!boundaryReadyRef.current) return;
    setRefreshRevision((value) => value + 1);
  }, []);
  const previousPage = React.useCallback(() => {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setNavigation((current) => current.key !== navigationKey
      ? Object.freeze({ key: navigationKey, cursor: null, history: Object.freeze([]) })
      : Object.freeze({
          key: navigationKey,
          cursor: previous,
          history: Object.freeze(current.history.slice(0, -1)),
        }));
  }, [cursorHistory, navigationKey]);
  const nextPage = React.useCallback(() => {
    if (!page.page.nextCursor) return;
    setNavigation((current) => current.key !== navigationKey
      ? Object.freeze({ key: navigationKey, cursor: null, history: Object.freeze([]) })
      : Object.freeze({
          key: navigationKey,
          cursor: page.page.nextCursor,
          history: Object.freeze([...current.history, current.cursor]),
        }));
  }, [navigationKey, page.page.nextCursor]);
  const upsertDrive = React.useCallback((drive: StorageStudioDrive) => {
    setPage((current) => {
      const found = current.items.some((item) => item.drive.drive_id === drive.drive.drive_id);
      const items = found
        ? current.items.map((item) => item.drive.drive_id === drive.drive.drive_id ? drive : item)
        : [drive, ...current.items];
      return Object.freeze({
        ...current,
        items: Object.freeze(items),
        page: Object.freeze({ ...current.page, count: items.length }),
      });
    });
  }, []);
  const removeDrive = React.useCallback((driveId: string) => {
    setPage((current) => {
      const items = current.items.filter((item) => item.drive.drive_id !== driveId);
      return Object.freeze({
        ...current,
        items: Object.freeze(items),
        page: Object.freeze({ ...current.page, count: items.length }),
      });
    });
  }, []);

  const visible = input.boundary.ready && loadedRequestKey === catalogRequestKey;
  const visiblePage = visible ? page : EMPTY_PAGE;

  return {
    capabilities: visible ? capabilities : null,
    drives: visiblePage.items,
    pagination: Object.freeze({
      page: visible ? cursorHistory.length + 1 : 1,
      count: visiblePage.page.count,
      hasPrevious: visible && cursorHistory.length > 0,
      hasNext: visiblePage.page.hasMore,
    }),
    loading: visible ? loading : scopeAvailable,
    disabled: visible ? disabled : !input.enabled,
    error: visible ? error : null,
    refresh,
    previousPage,
    nextPage,
    upsertDrive,
    removeDrive,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isStudioDisabled(value: unknown): boolean {
  const candidate = value as { readonly body?: unknown };
  const body = candidate?.body;
  return Boolean(body && typeof body === 'object'
    && !Array.isArray(body)
    && (body as Record<string, unknown>).code === 'STORAGE_STUDIO_DISABLED');
}
