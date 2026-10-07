/** Synthetic rows and real SDK collections for shared page-size/selection regression coverage. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineTable, field } from '../../schema';
import { createClient, type InternalClient } from '../../frontend/client/sdk';
import { ClientProvider } from '../../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { MasterDetailPage } from '../master-detail/master-detail-page';
import { DataTable } from './data-table';
import type { DataTableState } from './data-table-state';
import type { DataTableServerAdapter, DataTableServerQuery } from './data-table-server-types';

type TestRow = { id: string; name: string };
type Mode = 'array' | 'controlled' | 'collection' | 'offset' | 'cursor' | 'master';
const records = defineTable('records', { name: field.text() }, { pk: 'id', sync: 'full' });
const rows = Array.from({ length: 140 }, (_, index) => ({ id: String(index + 1), name: `Record ${String(index + 1).padStart(3, '0')}` }));
const client = createClient({ url: 'http://127.0.0.1:1', auth: false, autoConnect: false,
  tables: { records: records.clientTable } });
client.collection<TestRow>('records').load(rows, { replace: true });
let count = rows.length;
let knownTotal = false;
let selected: string[] = [];
let latest: DataTableState;
const queries: DataTableServerQuery[] = [];
const adapter: DataTableServerAdapter<TestRow> = {
  async query(query, { signal }) {
    queries.push(structuredClone(query));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let matching = rows.slice(0, count).filter(row => row.name.toLowerCase().includes(query.search.toLowerCase()));
    for (const filter of query.filters) matching = matching.filter(row => String(row[filter.id as keyof TestRow]).includes(String(filter.value)));
    if (query.sorting[0]?.desc) matching.reverse();
    const offset = query.pagination.mode === 'cursor'
      ? Number(query.pagination.cursor?.slice('after-'.length) ?? 0)
      : query.pagination.pageIndex * query.pagination.pageSize;
    const pageRows = matching.slice(offset, offset + query.pagination.pageSize);
    const hasMore = offset + pageRows.length < matching.length;
    return { rows: pageRows, page: query.pagination.mode === 'cursor'
      ? { mode: 'cursor', hasMore, nextCursor: hasMore ? `after-${offset + pageRows.length}` : null }
      : { mode: 'offset', offset, hasMore, ...(knownTotal ? { total: matching.length } : {}) } };
  },
};
let changeMode: (mode: Mode) => void;
let changeRows: (count: number) => void;
let changeState: (state: Partial<DataTableState>) => void;
let changeTable: () => void;

function Workspace({ mode }: { mode: Mode }) {
  const [data, setData] = React.useState(rows);
  const [controls, setControls] = React.useState<Partial<DataTableState>>({});
  const [table, setTable] = React.useState('records');
  changeState = patch => setControls(previous => ({ ...previous, ...patch }));
  changeTable = () => setTable(previous => previous === 'records' ? 'other-records' : 'records');
  changeRows = length => {
    count = length; setData(rows.slice(0, length));
    client.collection<TestRow>('records').load(rows.slice(0, length), { replace: true });
  };
  const source = mode === 'collection' ? { type: 'collection' as const, table: 'records' }
    : mode === 'offset' || mode === 'cursor' || mode === 'master'
      // Isolate logical anchoring from adjacent speculative calls; default prefetch has its own source browser suite.
      ? { type: 'server' as const, table, pagination: mode === 'cursor' ? 'cursor' as const : 'offset' as const, adapter, prefetch: false }
      : { type: 'data' as const, data };
  return mode === 'master'
    ? <MasterDetailPage<TestRow> schema={records.schema} source={source} listColumns={['name']}
      paginated={{ pageSize: 20 }} searchable={false} renderDetail={item => <p>{item.name} detail</p>} />
    : <DataTable<TestRow> schema={records.schema} source={source} columns={['name']}
      initialState={{ pagination: { pageIndex: mode === 'cursor' ? 0 : 3, pageSize: 20 } }}
      paginated={{ pageSize: 20 }} searchable={{ fields: ['name'], ariaLabel: 'Search records' }} selectable
      state={mode === 'controlled' || mode === 'offset' || mode === 'cursor' ? controls : undefined}
      onStateChange={next => { latest = next; if (mode === 'controlled' || mode === 'offset' || mode === 'cursor') setControls(next); }}
      onSelectionChange={ids => { selected = ids; }} showExport={false} showColumnVisibility={false} />;
}
function Fixture() {
  const [mode, setMode] = React.useState<Mode>('array');
  changeMode = next => { count = rows.length; knownTotal = false; selected = []; client.collection<TestRow>('records').load(rows, { replace: true }); setMode(next); };
  return <ClientProvider client={client}><main style={{ width: 'min(100%, 1000px)', margin: 'auto', padding: 12 }}>
    <Workspace key={mode} mode={mode} />
  </main></ClientProvider>;
}
declare global {
  interface Window {
    __pageSizeTable: {
      mode(mode: Mode): void;
      rows(count: number): void;
      state(): DataTableState;
      control(state: Partial<DataTableState>): void;
      selection(): string[];
      queries(): DataTableServerQuery[];
      knownTotal(value: boolean): void;
      source(): void;
      boundary(): void;
    };
  }
}
window.__pageSizeTable = {
  mode: next => changeMode(next), rows: length => changeRows(length), state: () => latest,
  control: next => changeState(next), selection: () => selected, queries: () => queries,
  knownTotal: value => { knownTotal = value; }, source: () => changeTable(),
  boundary: () => ((client as InternalClient)._authorizationDataBoundary as AuthorizationDataBoundaryController).invalidate(),
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
