/** Public DataTable + SDK boundary fixture. Deferred /api/data receipts and admitted Sync events are synthetic; no app credentials or database. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableState } from './data-table-state';
import type { DataTableServerChange } from './data-table-server-types';

type Item = { id: string; name: string; rank: number };
interface Read { path: string; signal: AbortSignal; resolve(value: unknown): void }
const reads: Read[] = [], saved = new Map<string, Element>();
const listeners = new Set<(message: { type: string; [key: string]: unknown }) => void>();
const events: FrontendObservabilityEvent[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
const client = {
  _syncClient: { tables: {}, onMessage(listener: (message: { type: string; [key: string]: unknown }) => void) {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } },
  fetch(path: string, { signal }: { signal: AbortSignal }) {
    return new Promise(resolve => { reads.push({ path, signal, resolve }); });
  },
} as unknown as Client;
const schema = defineSchema({ name: field.text(), rank: field.number() });
let setState: React.Dispatch<React.SetStateAction<Partial<DataTableState>>>;
let setIncludeTotal: React.Dispatch<React.SetStateAction<boolean>>;
let latest: Partial<DataTableState>;
const harness = {
  reads() { return reads.map(({ path, signal }) => {
    const params = new URL(path, 'http://zero.test').searchParams;
    return { path, aborted: signal.aborted, offset: Number(params.get('offset')), limit: Number(params.get('limit')),
      includeTotal: params.get('includeTotal'), filters: params.getAll('filter'), search: params.get('search') };
  }); },
  accept(index: number, rows: Item[], total?: number) {
    const read = reads[index]!, params = new URL(read.path, 'http://zero.test').searchParams;
    const limit = Number(params.get('limit')), offset = Number(params.get('offset'));
    const hasMore = total === undefined ? rows.length === limit : offset + rows.length < total;
    read.resolve({ rows, page: { limit, offset, count: rows.length, hasMore,
      nextOffset: hasMore ? offset + limit : null, ...(total === undefined ? {} : { total }) } });
  },
  emit(change: DataTableServerChange) {
    for (const listener of listeners) listener({ type: 'sync.change', table: 'records', ...change,
      ...(change.op === 'DELETE' ? {} : { row: { id: change.rowId } }) });
  },
  state() { return latest; },
  change(patch: Partial<DataTableState>) { setState(previous => ({ ...previous, ...patch })); },
  includeTotal(value: boolean) { setIncludeTotal(value); },
  save(id: string) { const row = document.querySelector(`[data-row-id="${id}"]`); if (row) saved.set(id, row); },
  same(id: string) { return saved.get(id) === document.querySelector(`[data-row-id="${id}"]`); },
  events() { return events.map(event => event.code); },
};
declare global { interface Window { __liveTotal: typeof harness } }
window.__liveTotal = harness;
function Fixture() {
  const [state, updateState] = React.useState<Partial<DataTableState>>({
    sorting: [{ id: 'rank', desc: true }], pagination: { pageIndex: 0, pageSize: 2 },
  });
  const [includeTotal, updateTotal] = React.useState(true);
  latest = state; setState = updateState; setIncludeTotal = updateTotal;
  return <DataTable<Item> schema={schema} source={{ type: 'server', table: 'records', prefetch: false, includeTotal }}
    columns={['name', 'rank']} searchable={{ fields: ['name'], ariaLabel: 'Search total records' }}
    paginated={{ pageSize: 2 }} state={state} onStateChange={updateState}
    showExport={false} showColumnVisibility={false} />;
}
createRoot(document.getElementById('root')!).render(<ClientProvider client={client}><Fixture /></ClientProvider>);
