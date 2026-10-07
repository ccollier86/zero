/** Actual DataTable server-pill fixture: deferred app-owned reads and membership only, no provider, authentication, app, or database. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableServerAdapter, DataTableServerChange, DataTableServerQuery, DataTableServerResult } from './data-table-server-types';

type Item = { id: string; name: string; rank: number };
interface Read { query: DataTableServerQuery; signal: AbortSignal; resolve(result: DataTableServerResult<Item>): void }
const reads: Read[] = [];
const lookups: { query: DataTableServerQuery; ids: readonly string[]; signal: AbortSignal; resolve(ids: readonly string[]): void }[] = [];
const subscriptions: { signal: AbortSignal; listener(change: DataTableServerChange): void }[] = [];
const schema = defineSchema({ name: field.text(), rank: field.number() });
const adapter: DataTableServerAdapter<Item> = {
  query(query, { signal }) { return new Promise(resolve => { reads.push({ query, signal, resolve }); }); },
  confirmInsertedRows(query, ids, { signal }) { return new Promise(resolve => { lookups.push({ query, ids, signal, resolve }); }); },
  subscribeChanges(_query, listener, { signal }) { subscriptions.push({ signal, listener }); return () => {}; },
};
let saved: Element[] = [];
const harness = {
  reads() { return reads.map(({ query, signal }) => ({ query, aborted: signal.aborted })); },
  lookups() { return lookups.map(({ query, ids, signal }) => ({ query, ids, aborted: signal.aborted })); },
  accept(index: number, rows: Item[], hasMore: boolean, total: number) {
    const read = reads[index]!;
    read.resolve({ rows, page: { mode: 'offset', offset: read.query.pagination.pageIndex * read.query.pagination.pageSize, hasMore, total } });
  },
  confirm(index: number, ids: readonly string[]) { lookups[index]!.resolve(ids); },
  emit(change: DataTableServerChange) { const current = subscriptions[subscriptions.length - 1]; current?.listener(change); },
  saveRows() { saved = [...document.querySelectorAll('tr[data-row-id]:not([data-table-leaving])')]; },
  sameRows() { const current = [...document.querySelectorAll('tr[data-row-id]:not([data-table-leaving])')];
    return current.length === saved.length && current.every((row, index) => row === saved[index]); },
};
declare global { interface Window { __serverInsertPill: typeof harness } }
window.__serverInsertPill = harness;
createRoot(document.getElementById('root')!).render(<DataTable<Item> schema={schema}
  source={{ type: 'server', table: 'records', adapter, prefetch: false }} columns={['name', 'rank']}
  searchable={{ fields: ['name'] }} paginated={{ pageSize: 2 }} showExport={false} showColumnVisibility={false}
  initialState={{ sorting: [{ id: 'rank', desc: true }] }} />);
