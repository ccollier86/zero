'use client';

/** Server-page loading with bounded prefetch/cache, previous-page presentation and live Zero authorization fences. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { isAuthorizationDataReady, isAuthorizationScopeReady } from '../../frontend/client/authorization-scope-readiness';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import type { Row } from '../../sync/types';
import { createDataTableApiAdapter, dataTableServerQueryKey, normalizeDataTableServerResult } from './data-table-server-query';
import { DataTableServerRequestCoordinator } from './data-table-server-request-coordinator';
import { DataTableServerPageCache } from './data-table-server-page-cache';
import { DataTableServerInsertEvidence, subscribeDataTableServerChanges } from './data-table-server-changes';
import { DataTableServerInsertMembership } from './data-table-server-insert-membership';
import { dataTableServerSourceIdentity } from './data-table-server-source-identity';
import { dataTableServerPartitionMatches, dataTableServerStateMatches, normalizeDataTableServerFailure, projectDataTableServerRows, resolveDataTableServerQuery } from './data-table-server-source-state';
import { DataTableServerSourceError, type DataTableServerPage, type DataTableServerQuery, type DataTableServerSource } from './data-table-server-types';
export { dataTableServerStateMatches, projectDataTableServerRows } from './data-table-server-source-state';

const EMPTY_ROWS: never[] = [];
const useLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export type DataTableServerChangeReason = 'query' | 'refresh' | 'live';
interface Accepted<T extends Row> {
  boundaryKey: string; partition: string; signature: string; data: T[];
  membershipKey: string;
  result: { rows: T[]; page: DataTableServerPage }; query: DataTableServerQuery;
  changeReason: DataTableServerChangeReason; revision: number;
  liveInsertedRowIds: readonly string[];
}
interface Failure { boundaryKey: string; signature: string; error: Error }
export interface UseDataTableServerSourceOptions<T extends Row> {
  source: DataTableServerSource<T> | null;
  query?: DataTableServerQuery;
  primaryKey?: string;
  /** Collection changes invalidate caches; this snapshot alone does not prove a live insertion. */
  liveRevision?: readonly T[] | null;
  /** Disabling live-update presentation also suppresses independent membership RPCs. Defaults to true. */
  confirmLiveInsertions?: boolean;
}
export interface DataTableServerSourceState<T extends Row> {
  data: T[]; page: DataTableServerPage | null; isLoading: boolean; error: Error | null;
  refresh: () => Promise<void>;
  prefetchPage: (pageIndex: number) => Promise<void>;
  /** Retained same-partition rows are presentation-only during a different query. */
  isPreviousData: boolean;
  requestKey: string | null;
  resolvedRequestKey: string | null;
  resultRevision: number;
  /** Why this page was accepted; 'live' means invalidation, not proof of INSERT. */
  changeReason: DataTableServerChangeReason | null;
  /** Genuine live INSERTs confirmed by this exact accepted response; never a total of unseen matching records. */
  liveInsertedRowIds: readonly string[];
  /** Genuine INSERTs authoritatively confirmed against these criteria, including off-page identities; lookup rows never enter data. */
  confirmedLiveInsertedRowIds: readonly string[];
  /** Reveal/retirement clears pending and confirmed live evidence and aborts its owned lookups. */
  clearLiveInsertions: () => void;
}

/** Starts reads immediately; never carries cached/accepted rows across source or authorization partitions. */
export function useDataTableServerSource<T extends Row>(options: UseDataTableServerSourceOptions<T>): DataTableServerSourceState<T> {
  const client = useClientMaybe(), authorization = useAuthorizationScopeBoundary(client);
  const resolution = resolveDataTableServerQuery(options.source, options.query);
  const identity = dataTableServerSourceIdentity(options.source, client);
  const partition = JSON.stringify([authorization.key, options.source?.table, options.source?.pagination ?? 'offset', identity, options.primaryKey]);
  const signature = resolution.query && options.source
    ? JSON.stringify([partition, dataTableServerQueryKey(options.source.table, resolution.query)])
    : JSON.stringify([partition, resolution.error instanceof DataTableServerSourceError ? resolution.error.code : null]);
  const membershipKey = resolution.query && options.source
    ? JSON.stringify([partition, dataTableServerQueryKey(options.source.table, { ...resolution.query,
      pagination: { mode: 'offset', pageIndex: 0, pageSize: resolution.query.pagination.pageSize } })])
    : signature;
  const coordinatorRef = useRef<DataTableServerRequestCoordinator | null>(null);
  const cacheRef = useRef<DataTableServerPageCache<T> | null>(null);
  const insertEvidenceRef = useRef<DataTableServerInsertEvidence | null>(null);
  const membershipRef = useRef<DataTableServerInsertMembership | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = new DataTableServerRequestCoordinator();
  if (!cacheRef.current) cacheRef.current = new DataTableServerPageCache<T>();
  if (!insertEvidenceRef.current) insertEvidenceRef.current = new DataTableServerInsertEvidence();
  if (!membershipRef.current) membershipRef.current = new DataTableServerInsertMembership();
  const coordinator = coordinatorRef.current, cache = cacheRef.current;
  const insertEvidence = insertEvidenceRef.current;
  const membership = membershipRef.current;
  const configuredMembershipKey = useRef<string | null>(null);
  const [, publishMembership] = useState(0);
  insertEvidence.reconcile(signature);
  const mounted = useRef(false), revision = useRef(0);
  const current = useRef({ client, options, resolution, partition, signature, membershipKey, boundaryKey: authorization.key });
  current.current = { client, options, resolution, partition, signature, membershipKey, boundaryKey: authorization.key };
  const acceptedRef = useRef<Accepted<T> | null>(null);
  const [accepted, setAccepted] = useState<Accepted<T> | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const readBoundary = () => {
    const internal = current.current.client as InternalClient | null, auth = internal?.auth ?? null;
    const dataRevision = internal?._authorizationDataBoundary?.revision ?? 0;
    return { key: readAuthorizationScopeBoundaryKey(auth, dataRevision), ready: auth
      ? isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(dataRevision, auth.authorizationState.status, auth.isAuthenticated) : true };
  };
  const admitted = (captured: typeof current.current) => {
    const boundary = readBoundary();
    if (!boundary.ready || boundary.key !== current.current.boundaryKey) {
      cache.invalidate(); coordinator.cancel(); return false;
    }
    return mounted.current && boundary.key === captured.boundaryKey && current.current.partition === captured.partition;
  };
  const transport = (captured: typeof current.current) => {
    const source = captured.options.source!;
    const adapter = source.adapter ?? (captured.client ? createDataTableApiAdapter<T>(captured.client, source.table) : null);
    if (!adapter) throw new DataTableServerSourceError('The built-in DataTable server source requires a Zero client provider.', 'DATA_TABLE_SERVER_CLIENT_REQUIRED');
    return async (query: DataTableServerQuery, signal: AbortSignal) => {
      if (!admitted(captured) || signal.aborted) throw new Error('DataTable server request was retired.');
      const value = await adapter.query(query, { signal });
      if (!admitted(captured) || signal.aborted) throw new Error('DataTable server request was retired.');
      const result = normalizeDataTableServerResult<T>(value, source.pagination ?? 'offset');
      projectDataTableServerRows(result.rows, captured.options.primaryKey, source.getRowId);
      return result;
    };
  };
  const report = (source: DataTableServerSource<T>, error: Error) => emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, {
    metadata: { table: source.table, paginationMode: source.pagination ?? 'offset',
      errorCode: error instanceof DataTableServerSourceError ? error.code : 'DATA_TABLE_SERVER_QUERY_FAILED' },
  });
  const clearLiveInsertions = useCallback(() => { insertEvidence.clear(); membership.clear(); }, [insertEvidence, membership]);
  const prefetchPage = useCallback(async (pageIndex: number): Promise<void> => {
    const captured = current.current, previous = acceptedRef.current, source = captured.options.source;
    if (!source || source.prefetch === false || !previous || previous.partition !== captured.partition
      || previous.signature !== captured.signature || !admitted(captured)) return;
    const query = cache.forPage(previous.query, previous.result, pageIndex);
    if (!query) return;
    try { await cache.request(query, transport(captured), undefined, () => admitted(captured)); }
    catch (cause) { if (admitted(captured)) report(source, normalizeDataTableServerFailure(cause)); }
  }, [cache, coordinator]);
  const load = useCallback(async (reason: DataTableServerChangeReason, invalidate: boolean): Promise<void> => {
    const captured = current.current, source = captured.options.source, query = captured.resolution.query;
    const boundary = readBoundary();
    cache.reconcile(captured.partition, boundary.ready && boundary.key === captured.boundaryKey);
    if (invalidate) cache.invalidate();
    coordinator.cancel();
    if (!source || !query || !admitted(captured)) {
      setLoadingKey(null);
      if (source && captured.resolution.error) setFailure({ boundaryKey: captured.boundaryKey, signature: captured.signature, error: captured.resolution.error });
      return;
    }
    cache.retireSpeculationExcept(query);
    const ticket = coordinator.begin(captured.boundaryKey, captured.signature);
    const isCurrent = () => admitted(captured) && current.current.signature === captured.signature
      && coordinator.isCurrent(ticket, readBoundary().key, readBoundary().ready);
    setFailure(null); setLoadingKey(captured.signature);
    try {
      const result = await cache.request(query, transport(captured), ticket.signal, () => admitted(captured));
      if (!result || !isCurrent()) return;
      const next = { boundaryKey: captured.boundaryKey, partition: captured.partition, signature: captured.signature,
        membershipKey: captured.membershipKey,
        data: result.rows, result, query, changeReason: reason, revision: ++revision.current,
        liveInsertedRowIds: insertEvidence.accept(captured.signature,
          projectDataTableServerRows(result.rows, captured.options.primaryKey, source.getRowId).orderedIds) };
      acceptedRef.current = next; setAccepted(next);
      if (source.prefetch !== false) {
        void prefetchPage(query.pagination.pageIndex - 1);
        if (result.page.hasMore) void prefetchPage(query.pagination.pageIndex + 1);
      }
    } catch (cause) {
      if (!isCurrent()) return;
      const error = normalizeDataTableServerFailure(cause);
      setFailure({ boundaryKey: captured.boundaryKey, signature: captured.signature, error }); report(source, error);
    } finally {
      const active = isCurrent(); coordinator.finish(ticket);
      if (active) setLoadingKey(null);
    }
  }, [cache, coordinator, prefetchPage, insertEvidence]);
  const refresh = useCallback(() => load('refresh', true), [load]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cache.invalidate(); coordinator.cancel(); insertEvidence.clear(); membership.cancel(); }; }, [cache, coordinator, insertEvidence, membership]);
  useLayout(() => {
    const captured = current.current, source = captured.options.source, query = captured.resolution.query;
    const adapter = source?.adapter ?? (captured.client && source && !source.getRowId
      ? createDataTableApiAdapter<T>(captured.client, source.table, captured.options.primaryKey) : null);
    const supported = source && query && source.live !== false && captured.options.confirmLiveInsertions !== false
      && adapter?.confirmInsertedRows && authorization.ready;
    const isCurrent = () => admitted(captured) && current.current.membershipKey === captured.membershipKey
      && current.current.options.confirmLiveInsertions !== false && current.current.options.source?.live !== false;
    configuredMembershipKey.current = captured.membershipKey;
    membership.configure({ key: captured.membershipKey,
      confirm: supported ? async (ids, signal) => {
        if (!isCurrent() || signal.aborted) return [];
        const confirmed = await adapter!.confirmInsertedRows!(query!, ids, { signal });
        return isCurrent() && !signal.aborted ? confirmed : [];
      } : null,
      isCurrent,
      onChange: () => { if (mounted.current) publishMembership(value => value + 1); },
      onError: cause => { if (source && isCurrent()) report(source, normalizeDataTableServerFailure(cause)); },
    });
  }, [signature, membershipKey, options.source?.live, options.source?.adapter?.confirmInsertedRows,
    options.confirmLiveInsertions, authorization.ready, membership]);
  useEffect(() => { void load('query', false); return () => coordinator.cancel(); }, [signature, authorization.ready, load, coordinator]);
  useEffect(() => { if (options.source?.prefetch === false) cache.retireSpeculationExcept(); }, [options.source?.prefetch, cache]);
  useEffect(() => {
    const captured = current.current, source = captured.options.source, query = captured.resolution.query;
    if (!source || !query || source.live === false || !admitted(captured)) return;
    const controller = new AbortController(); let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeDataTableServerChanges(source, query, captured.client as InternalClient | null, change => {
        if (!admitted(captured) || current.current.signature !== captured.signature) return;
        const baseline = acceptedRef.current;
        if (baseline?.signature === captured.signature) insertEvidence.observe(change,
          projectDataTableServerRows(baseline.data, captured.options.primaryKey, source.getRowId).orderedIds);
        if (baseline?.membershipKey === captured.membershipKey) membership.observe(change,
          projectDataTableServerRows(baseline.data, captured.options.primaryKey, source.getRowId).orderedIds);
        else if (change.op !== 'INSERT') membership.observe(change, EMPTY_ROWS);
        void load('live', true);
      }, controller.signal);
    } catch (cause) { if (admitted(captured)) report(source, normalizeDataTableServerFailure(cause)); }
    return () => {
      controller.abort(); insertEvidence.clear();
      try { unsubscribe?.(); } catch (cause) { if (mounted.current) report(source, normalizeDataTableServerFailure(cause)); }
    };
  }, [signature, authorization.ready, options.source?.live, options.source?.adapter?.subscribeChanges, insertEvidence, membership, load]);
  const liveRef = useRef({ table: options.source?.table, boundaryKey: authorization.key, value: options.liveRevision });
  useEffect(() => {
    const previous = liveRef.current;
    liveRef.current = { table: options.source?.table, boundaryKey: authorization.key, value: options.liveRevision };
    if (options.source && options.source.live !== false && previous.table === options.source.table
      && previous.boundaryKey === authorization.key && previous.value !== options.liveRevision) void load('live', true);
  }, [options.liveRevision, options.source?.live, options.source?.table, authorization.key, load]);
  const visible = dataTableServerPartitionMatches(accepted, partition, authorization.ready);
  const exact = visible && accepted.signature === signature;
  const visibleFailure = dataTableServerStateMatches(failure, authorization.key, signature, authorization.ready);
  return { data: visible ? accepted.data : EMPTY_ROWS as T[], page: visible ? accepted.result.page : null,
    isLoading: !!options.source && authorization.ready && (loadingKey === signature || !exact && !visibleFailure),
    error: visibleFailure ? failure.error : null, refresh, prefetchPage, isPreviousData: !!visible && !exact,
    requestKey: options.source ? signature : null, resolvedRequestKey: visible ? accepted.signature : null,
    resultRevision: visible ? accepted.revision : 0, changeReason: visible ? accepted.changeReason : null,
    liveInsertedRowIds: exact ? accepted.liveInsertedRowIds : EMPTY_ROWS,
    confirmedLiveInsertedRowIds: configuredMembershipKey.current === membershipKey && authorization.ready
      && options.confirmLiveInsertions !== false && options.source?.live !== false ? membership.confirmedIds() : EMPTY_ROWS,
    clearLiveInsertions };
}
