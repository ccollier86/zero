/**
 * Public DataTable new-record navigation fixture.
 * Owns synthetic complete datasets and deferred SDK receipts only; production
 * sorting, buffering, footer presentation and navigation remain unchanged.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableState } from './data-table-state';
import type { DataTableServerChange } from './data-table-server-types';

export type NavigationItem = { id: string; name: string; rank: number };
interface Read { path: string; signal: AbortSignal; resolve(value: unknown): void }
const reads: Read[] = [];
const listeners = new Set<(message: { type: string; [key: string]: unknown }) => void>();
const observability: string[] = [];
const saved = new Map<string, Element>();
configureFrontendObservability({ sink: { emit(event) { observability.push(event.code); } } });
const client = {
  _syncClient: { tables: {}, onMessage(listener: (message: { type: string; [key: string]: unknown }) => void) {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } },
  fetch(path: string, { signal }: { signal: AbortSignal }) {
    return new Promise(resolve => { reads.push({ path, signal, resolve }); });
  },
} as unknown as Client;
const schema = defineSchema({ name: field.text(), rank: field.number() });
const initial = Array.from({ length: 12 }, (_, index) => ({ id: `r${index + 1}`, rank: index + 1, name: `Alpha ${index + 1}` }));
let setRows: React.Dispatch<React.SetStateAction<NavigationItem[]>>;
let setState: React.Dispatch<React.SetStateAction<Partial<DataTableState>>>;
let setLoading: React.Dispatch<React.SetStateAction<boolean>>;
let latest: Partial<DataTableState>;
const harness = {
  insert(rows: NavigationItem[]) { setRows(previous => [...previous, ...rows]); },
  replace(rows: NavigationItem[]) { setRows(rows); setLoading(false); },
  initial() { setRows(initial); setLoading(false); },
  loading(value: boolean) { setLoading(value); },
  update(id: string, patch: Partial<NavigationItem>) { setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row)); },
  change(patch: Partial<DataTableState>) { setState(previous => ({ ...previous, ...patch })); },
  state() { return latest; },
  save(id: string) { const row = document.querySelector(`[data-row-id="${id}"]`); if (row) saved.set(id, row); },
  same(id: string) { return saved.get(id) === document.querySelector(`[data-row-id="${id}"]`); },
  reads() { return reads.map(({ path, signal }) => {
    const params = new URL(path, 'http://zero.test').searchParams;
    return { path, aborted: signal.aborted, offset: Number(params.get('offset')), limit: Number(params.get('limit')),
      includeTotal: params.get('includeTotal'), filters: params.getAll('filter'), sort: params.getAll('sort'), search: params.get('search') };
  }); },
  accept(index: number, rows: NavigationItem[], total?: number) {
    const read = reads[index]!, params = new URL(read.path, 'http://zero.test').searchParams;
    const limit = Number(params.get('limit')), offset = Number(params.get('offset'));
    const hasMore = total === undefined ? rows.length === limit : offset + rows.length < total;
    read.resolve({ rows, page: { limit, offset, count: rows.length, hasMore,
      nextOffset: hasMore ? offset + limit : null, ...(total === undefined ? {} : { total }) } });
  },
  emit(change: DataTableServerChange) { for (const listener of listeners) listener({ type: 'sync.change', table: 'records', ...change,
    ...(change.op === 'DELETE' ? {} : { row: { id: change.rowId } }) }); },
  events() { return observability; },
};
declare global { interface Window { __newRecordNavigation: typeof harness } }
window.__newRecordNavigation = harness;

function Fixture() {
  const loading = document.documentElement.dataset.loading === 'true';
  const server = document.documentElement.dataset.server === 'true';
  const scroll = document.documentElement.dataset.scroll === 'true';
  const desc = document.documentElement.dataset.desc !== 'false';
  const [rows, updateRows] = React.useState(loading ? [] : initial);
  const [isLoading, updateLoading] = React.useState(loading);
  const [state, updateState] = React.useState<Partial<DataTableState>>({
    sorting: [{ id: 'rank', desc }],
    pagination: { pageIndex: Number(document.documentElement.dataset.page ?? 0), pageSize: 3 },
  });
  setRows = updateRows; setState = updateState; setLoading = updateLoading; latest = state;
  return <div data-navigation-scroll-owner style={{ maxWidth: 850, height: scroll ? 210 : undefined, overflowY: scroll ? 'auto' : undefined }}>
    <DataTable<NavigationItem> schema={schema} primaryKey="id"
      source={server ? { type: 'server', table: 'records', prefetch: false } : { type: 'data', data: rows, isLoading }}
      columns={['name', 'rank']} searchable={{ fields: ['name'], ariaLabel: 'Search arrival records' }}
      state={state} onStateChange={updateState} paginated={scroll ? false : { pageSize: 3 }}
      showExport={false} showColumnVisibility={false} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<ClientProvider client={client}><Fixture /></ClientProvider>);
