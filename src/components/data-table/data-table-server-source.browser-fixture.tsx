/** Isolated hook fixture: deferred adapters and real Zero provider/boundary subscriptions, no app data or network. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { useDataTableServerSource, type DataTableServerSourceState } from './use-data-table-server-source';
import type { DataTableServerAdapter, DataTableServerChange, DataTableServerQuery, DataTableServerResult, DataTableServerSource } from './data-table-server-types';

type Item = { id: string; name: string };
interface Receipt { query: DataTableServerQuery; signal: AbortSignal; table: string; adapter: number; path?: string;
  resolve(value: DataTableServerResult<Item>): void; reject(cause: Error): void }
const listeners = new Set<() => void>(), dataBoundary = new AuthorizationDataBoundaryController();
let scope = 'organization-a';
const auth = {
  user: { userId: 'synthetic-user' }, activeTenant: { tenantId: scope },
  isAuthenticated: true, isLoading: false, isRestoring: false,
  get authorizationScopeKey() { return scope; },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  authorizationState: { status: 'ready' },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  subscribeAuthorization(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
const calls: Receipt[] = [], events: FrontendObservabilityEvent[] = [];
const confirmations: { query: DataTableServerQuery; rowIds: readonly string[]; signal: AbortSignal;
  resolve(ids: readonly string[]): void; reject(cause: Error): void }[] = [];
const subscriptions: { query: DataTableServerQuery; signal: AbortSignal; listener: (change: DataTableServerChange) => void }[] = [];
const syncListeners = new Set<(message: { type: string; [key: string]: unknown }) => void>();
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
function adapter(table: string, id: number): DataTableServerAdapter<Item> {
  return { query(query, { signal }) { return new Promise((resolve, reject) => {
    calls.push({ query, signal, table, adapter: id, resolve, reject });
  }); }, subscribeChanges(query, listener, { signal }) { subscriptions.push({ query, listener, signal }); return () => {}; } };
}
const adapters = [adapter('records', 0), adapter('records', 1), adapter('other_records', 2)];
const membershipAdapter = adapter('records', 4);
membershipAdapter.confirmInsertedRows = (query, rowIds, { signal }) => new Promise((resolve, reject) => {
  confirmations.push({ query, rowIds, signal, resolve, reject });
});
adapters[4] = membershipAdapter;
const client = { auth, _authorizationDataBoundary: dataBoundary, _syncClient: {
  onMessage(listener: (message: { type: string; [key: string]: unknown }) => void) { syncListeners.add(listener); return () => { syncListeners.delete(listener); }; },
}, fetch(path: string, { signal }: { signal: AbortSignal }) {
  const parameters = new URLSearchParams(path.split('?')[1]), pageSize = Number(parameters.get('limit')), offset = Number(parameters.get('offset'));
  const query: DataTableServerQuery = { search: parameters.get('search') ?? '', filters: [], sorting: [], pagination: { mode: 'offset', pageIndex: offset / pageSize, pageSize } };
  return new Promise<DataTableServerResult<Item>>((resolve, reject) => calls.push({ query, signal, table: parameters.get('table')!, adapter: -1, path, resolve, reject }))
    .then(result => ({ rows: result.rows, page: { limit: pageSize, offset, count: result.rows.length,
      hasMore: result.page.hasMore, nextOffset: result.page.hasMore ? offset + pageSize : null } }));
} } as unknown as Client;
let latest: DataTableServerSourceState<Item>;
const notify = () => { for (const listener of listeners) listener(); };
const harness = {
  queries() { return calls.map(({ query, table, adapter, path }) => ({ ...query, table, adapter, path })); },
  aborted(index: number) { return calls[index]!.signal.aborted; },
  resolve(index: number, rows: Item[], hasMore = false, cursor?: string, total?: number) {
    const query = calls[index]!.query;
    calls[index]!.resolve({ rows, page: query.pagination.mode === 'cursor'
      ? { mode: 'cursor', hasMore, ...(cursor === undefined ? {} : { nextCursor: cursor }), ...(total === undefined ? {} : { total }) }
      : { mode: 'offset', hasMore, offset: query.pagination.pageIndex * query.pagination.pageSize, ...(total === undefined ? {} : { total }) } });
  },
  reject(index: number) { calls[index]!.reject(new Error('SYNTHETIC_PRIVATE_SOURCE_ERROR')); },
  state() { const { data, page, isLoading, isPreviousData, requestKey, resolvedRequestKey, resultRevision, changeReason, liveInsertedRowIds, confirmedLiveInsertedRowIds, error } = latest;
    return { data, page, isLoading, isPreviousData, requestKey, resolvedRequestKey, resultRevision, changeReason, liveInsertedRowIds, confirmedLiveInsertedRowIds, error: error?.message ?? null }; },
  confirmations() { return confirmations.map(({ query, rowIds, signal }) => ({ query, rowIds, aborted: signal.aborted })); },
  confirm(index: number, ids: readonly string[]) { confirmations[index]!.resolve(ids); },
  rejectConfirmation(index: number) { confirmations[index]!.reject(new Error('PRIVATE_MEMBERSHIP_ERROR')); },
  clearLiveInsertions() { latest.clearLiveInsertions(); },
  search: (_search: string) => {}, page: (_page: number, _cursor?: string | null) => {},
  mode: (_mode: 'offset' | 'cursor') => {}, source: (_adapter: number) => {}, prefetchEnabled: (_value: boolean) => {},
  criteria: (_value: { search: string; filters: DataTableServerQuery['filters']; sorting: DataTableServerQuery['sorting'] }) => {},
  primaryKey: (_value: string | undefined) => {}, confirmEnabled: (_value: boolean) => {}, pageSize: (_value: number) => {},
  live: () => {}, rerender: () => {},
  prefetch(index: number) { return latest.prefetchPage(index); }, refresh() { return latest.refresh(); },
  scope(value: string, publish = true) { scope = value; auth.activeTenant = { tenantId: value }; if (publish) notify(); },
  notify,
  unavailable() { auth.authorizationState = { status: 'error' }; dataBoundary.invalidate(); },
  ready() { auth.authorizationState = { status: 'ready' }; notify(); },
  invalidate() { dataBoundary.invalidate(); },
  events() { return events.map(event => event.code); },
  subscriptionCount() { return subscriptions.length; },
  emit(change: DataTableServerChange, index = subscriptions.length - 1) { subscriptions[index]?.listener(change); },
  sync(message: { type: string; [key: string]: unknown }) { for (const listener of syncListeners) listener(message); },
  retired(index: number) { return subscriptions[index]!.signal.aborted; },
  unmount: () => {},
};
declare global { interface Window { __serverSource: typeof harness } }
window.__serverSource = harness;
function Fixture() {
  const [search, setSearch] = useState(''), [pagination, setPagination] = useState<DataTableServerQuery['pagination']>({ mode: 'offset', pageIndex: 0, pageSize: 2 });
  const [adapterIndex, setAdapterIndex] = useState(0), [prefetch, setPrefetch] = useState(true);
  const [filters, setFilters] = useState<DataTableServerQuery['filters']>([]), [sorting, setSorting] = useState<DataTableServerQuery['sorting']>([]);
  const [primaryKey, setPrimaryKey] = useState<string | undefined>(), [confirmEnabled, setConfirmEnabled] = useState(true);
  const [live, setLive] = useState<Item[]>([]), [render, setRender] = useState(0);
  harness.search = value => { setSearch(value); setPagination(current => ({ ...current, pageIndex: 0, ...(current.mode === 'cursor' ? { cursor: null } : {}) })); };
  harness.page = (pageIndex, cursor) => setPagination(current => ({ ...current, pageIndex, ...(cursor === undefined ? {} : { cursor }) }));
  harness.mode = mode => setPagination({ mode, pageIndex: 0, pageSize: 2, ...(mode === 'cursor' ? { cursor: null } : {}) });
  harness.source = value => { setAdapterIndex(value); setPagination(current => ({ ...current, pageIndex: 0, ...(current.mode === 'cursor' ? { cursor: null } : {}) })); };
  harness.prefetchEnabled = setPrefetch; harness.live = () => setLive([]); harness.rerender = () => setRender(current => current + 1);
  harness.criteria = value => { setSearch(value.search); setFilters(value.filters); setSorting(value.sorting); };
  harness.primaryKey = setPrimaryKey; harness.confirmEnabled = setConfirmEnabled;
  harness.pageSize = pageSize => setPagination(current => ({ ...current, pageSize }));
  const source: DataTableServerSource<Item> = { type: 'server', table: adapterIndex === 2 ? 'other_records' : 'records',
    adapter: adapters[adapterIndex], pagination: pagination.mode, prefetch };
  latest = useDataTableServerSource({ source, query: { search, sorting, filters, pagination, searchFields: ['name'] },
    primaryKey, confirmLiveInsertions: confirmEnabled, liveRevision: live });
  return <main data-render={render} data-confirm-enabled={confirmEnabled ? 'true' : 'false'}>
    <button type="button" onPointerEnter={() => { void latest.prefetchPage(1); }} onFocus={() => { void latest.prefetchPage(1); }}>Prefetch next</button>
    <output aria-label="Source state">{JSON.stringify(harness.state())}</output>
    {latest.data.map(item => <p key={item.id}>{item.name}</p>)}
  </main>;
}
const root = createRoot(document.getElementById('root')!);
harness.unmount = () => root.unmount();
root.render(<ClientProvider client={client}><Fixture /></ClientProvider>);
