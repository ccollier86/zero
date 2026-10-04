'use client';

/** Isolated, authorization-fenced loading for DataTable server sources. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import type { Row } from '../../sync/types';
import {
  createDataTableApiAdapter,
  dataTableServerQueryKey,
  normalizeDataTableServerQuery,
  normalizeDataTableServerResult,
} from './data-table-server-query';
import {
  DataTableServerRequestCoordinator,
  type DataTableServerRequestTicket,
} from './data-table-server-request-coordinator';
import { dataTableServerSourceIdentity } from './data-table-server-source-identity';
import {
  DataTableServerSourceError,
  type DataTableServerPage,
  type DataTableServerQuery,
  type DataTableServerSource,
} from './data-table-server-types';

const EMPTY_ROWS: never[] = [];

interface ServerRows<T extends Row> {
  byId: Record<string, T>;
  orderedIds: string[];
}

interface AcceptedServerState<T extends Row> extends ServerRows<T> {
  boundaryKey: string;
  signature: string;
  page: DataTableServerPage;
}

interface ServerFailure {
  boundaryKey: string;
  signature: string;
  error: Error;
}

export interface UseDataTableServerSourceOptions<T extends Row> {
  source: DataTableServerSource<T> | null;
  query?: DataTableServerQuery;
  primaryKey?: string;
  /** Reactive collection snapshot used only as a table-scoped invalidation signal. */
  liveRevision?: readonly T[] | null;
}

export interface DataTableServerSourceState<T extends Row> {
  data: T[];
  page: DataTableServerPage | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Keep server results separate from ReactiveDB's shared collection while
 * preserving deterministic order and row identity.
 */
export function projectDataTableServerRows<T extends Row>(
  rows: readonly T[],
  primaryKey?: string,
  getRowId?: (row: T, index: number) => string | number,
): ServerRows<T> {
  const byId = Object.create(null) as Record<string, T>;
  const orderedIds: string[] = [];
  rows.forEach((row, index) => {
    const candidate = getRowId
      ? getRowId(row, index)
      : row[primaryKey ?? 'id'];
    if ((typeof candidate !== 'string' && typeof candidate !== 'number')
      || String(candidate).length === 0) {
      throw invalidResponse();
    }
    const id = String(candidate);
    if (Object.prototype.hasOwnProperty.call(byId, id)) throw invalidResponse();
    byId[id] = row;
    orderedIds.push(id);
  });
  return { byId, orderedIds };
}

/** Load a DataTable server source with abort, request-order, and auth fences. */
export function useDataTableServerSource<T extends Row>(
  options: UseDataTableServerSourceOptions<T>,
): DataTableServerSourceState<T> {
  const client = useClientMaybe();
  const authorization = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = useRef(authorization.key);
  const boundaryReadyRef = useRef(authorization.ready);
  boundaryKeyRef.current = authorization.key;
  boundaryReadyRef.current = authorization.ready;

  const sourceRef = useRef(options.source);
  sourceRef.current = options.source;
  const nextQueryResolution = resolveQuery(options.source, options.query);
  const sourceIdentity = dataTableServerSourceIdentity(options.source);
  const nextSignature = nextQueryResolution.query && options.source
    ? JSON.stringify([
      sourceIdentity,
      dataTableServerQueryKey(options.source.table, nextQueryResolution.query),
    ])
    : failureSignature(
      options.source?.table ?? null,
      options.source?.pagination ?? 'offset',
      sourceIdentity,
      nextQueryResolution.error,
    );
  const queryCacheRef = useRef({
    signature: nextSignature,
    resolution: nextQueryResolution,
  });
  if (queryCacheRef.current.signature !== nextSignature) {
    queryCacheRef.current = {
      signature: nextSignature,
      resolution: nextQueryResolution,
    };
  }
  const queryResolution = queryCacheRef.current.resolution;
  const signature = nextSignature;
  const [accepted, setAccepted] = useState<AcceptedServerState<T> | null>(null);
  const [failure, setFailure] = useState<ServerFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const requestCoordinatorRef = useRef<DataTableServerRequestCoordinator | null>(null);
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = new DataTableServerRequestCoordinator();
  }
  const requestCoordinator = requestCoordinatorRef.current;
  const primaryKeyRef = useRef(options.primaryKey);
  primaryKeyRef.current = options.primaryKey;

  const refresh = useCallback((): Promise<void> => {
    const source = sourceRef.current;
    const query = queryResolution.query;
    const requestBoundaryKey = authorization.key;
    requestCoordinator.cancel();

    if (!source || !query || !authorization.ready) {
      setLoading(false);
      if (source && queryResolution.error) {
        setFailure({
          boundaryKey: requestBoundaryKey,
          signature,
          error: queryResolution.error,
        });
      }
      return Promise.resolve();
    }

    const adapter = source.adapter
      ?? (client ? createDataTableApiAdapter<T>(client, source.table) : null);
    if (!adapter) {
      setFailure({
        boundaryKey: requestBoundaryKey,
        signature,
        error: new DataTableServerSourceError(
          'The built-in DataTable server source requires a Zero client provider.',
          'DATA_TABLE_SERVER_CLIENT_REQUIRED',
        ),
      });
      setLoading(false);
      return Promise.resolve();
    }

    const ticket = requestCoordinator.begin(requestBoundaryKey, signature);
    setFailure(null);
    setLoading(true);

    return Promise.resolve()
      .then(() => adapter.query(query, { signal: ticket.signal }))
      .then((value) => normalizeDataTableServerResult<T>(
        value,
        source.pagination ?? 'offset',
      ))
      .then((result) => {
        if (!requestIsCurrent(
          requestCoordinator,
          ticket,
          boundaryKeyRef.current,
          boundaryReadyRef.current,
        )) return;
        const rows = projectDataTableServerRows(
          result.rows,
          primaryKeyRef.current,
          source.getRowId,
        );
        setAccepted({
          ...rows,
          boundaryKey: requestBoundaryKey,
          signature,
          page: result.page,
        });
      })
      .catch((cause) => {
        if (!requestIsCurrent(
          requestCoordinator,
          ticket,
          boundaryKeyRef.current,
          boundaryReadyRef.current,
        )) return;
        const error = normalizeQueryFailure(cause);
        setFailure({ boundaryKey: requestBoundaryKey, signature, error });
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, {
          metadata: {
            table: source.table,
            paginationMode: source.pagination ?? 'offset',
            errorCode: error instanceof DataTableServerSourceError
              ? error.code
              : 'DATA_TABLE_SERVER_QUERY_FAILED',
          },
        });
      })
      .finally(() => {
        const current = requestIsCurrent(
          requestCoordinator,
          ticket,
          boundaryKeyRef.current,
          boundaryReadyRef.current,
        );
        requestCoordinator.finish(ticket);
        if (current) setLoading(false);
      });
  }, [
    authorization.key,
    authorization.ready,
    client,
    queryResolution.error,
    queryResolution.query,
    requestCoordinator,
    signature,
  ]);

  useEffect(() => {
    void refresh();
    return () => {
      requestCoordinator.cancel();
    };
  }, [refresh, requestCoordinator]);

  const liveRef = useRef({
    table: options.source?.table ?? null,
    boundaryKey: authorization.key,
    revision: options.liveRevision,
  });
  useEffect(() => {
    const table = options.source?.table ?? null;
    const previous = liveRef.current;
    liveRef.current = {
      table,
      boundaryKey: authorization.key,
      revision: options.liveRevision,
    };
    if (!table
      || previous.table !== table
      || previous.boundaryKey !== authorization.key
      || previous.revision === options.liveRevision
      || options.source?.live === false) return;
    void refresh();
  }, [
    authorization.key,
    options.liveRevision,
    options.source?.live,
    options.source?.table,
    refresh,
  ]);

  const visible = dataTableServerStateMatches(
    accepted,
    authorization.key,
    signature,
    authorization.ready,
  );
  const visibleFailure = dataTableServerStateMatches(
    failure,
    authorization.key,
    signature,
    authorization.ready,
  );
  const data = visible
    ? accepted.orderedIds.map((id) => accepted.byId[id]!).filter(Boolean)
    : EMPTY_ROWS as T[];

  return {
    data,
    page: visible ? accepted.page : null,
    isLoading: !!options.source
      && authorization.ready
      && (loading || (!visible && !visibleFailure)),
    error: visibleFailure ? failure.error : null,
    refresh,
  };
}

/** Return whether isolated state belongs to the current query and authority. */
export function dataTableServerStateMatches<
  State extends { boundaryKey: string; signature: string },
>(
  state: State | null,
  boundaryKey: string,
  signature: string,
  ready: boolean,
): state is State {
  return !!state
    && ready
    && state.boundaryKey === boundaryKey
    && state.signature === signature;
}

function resolveQuery<T extends Row>(
  source: DataTableServerSource<T> | null,
  queryInput: DataTableServerQuery | undefined,
): { query: DataTableServerQuery | null; error: Error | null } {
  if (!source) return { query: null, error: null };
  try {
    const mode = source.pagination ?? 'offset';
    const query = normalizeDataTableServerQuery(queryInput ?? {
      search: '',
      filters: [],
      sorting: [],
      pagination: { mode, pageIndex: 0, pageSize: 20 },
    });
    if (query.pagination.mode !== mode) {
      throw new DataTableServerSourceError(
        'DataTable query pagination does not match its server source.',
        'DATA_TABLE_SERVER_QUERY_INVALID',
      );
    }
    if (mode === 'cursor' && !source.adapter) {
      throw new DataTableServerSourceError(
        'Cursor pagination requires a custom DataTable server adapter.',
        'DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED',
      );
    }
    return { query, error: null };
  } catch (error) {
    return { query: null, error: normalizeQueryFailure(error) };
  }
}

function failureSignature(
  table: string | null,
  pagination: 'offset' | 'cursor',
  sourceIdentity: string,
  error: Error | null,
): string {
  return JSON.stringify([
    table,
    pagination,
    sourceIdentity,
    error instanceof DataTableServerSourceError ? error.code : error?.name ?? null,
  ]);
}

function requestIsCurrent(
  coordinator: DataTableServerRequestCoordinator,
  ticket: DataTableServerRequestTicket,
  currentBoundaryKey: string,
  boundaryReady: boolean,
): boolean {
  return coordinator.isCurrent(ticket, currentBoundaryKey, boundaryReady);
}

function normalizeQueryFailure(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new DataTableServerSourceError(
    'DataTable server query failed.',
    'DATA_TABLE_SERVER_QUERY_FAILED',
  );
}

function invalidResponse(): DataTableServerSourceError {
  return new DataTableServerSourceError(
    'DataTable server adapter returned an invalid result.',
    'DATA_TABLE_SERVER_RESPONSE_INVALID',
  );
}
