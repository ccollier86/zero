/** Public DataTable initial presentation fixture; manually admitted synthetic results, never a client or database. */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableServerAdapter, DataTableServerResult } from './data-table-server-types';

type RecordRow = { id: string; name: string; value: number };
const records: RecordRow[] = Array.from({ length: 10 }, (_, index) => ({ id: `record-${index}`, name: `Complete value ${index}`, value: index }));
const schema = defineSchema({ name: field.text(), value: field.number() });
const mode = document.documentElement.dataset.initialMode ?? 'populated';
let admit: (count?: number) => void;
let resolveServer: ((value: DataTableServerResult<RecordRow>) => void) | undefined;
const adapter: DataTableServerAdapter<RecordRow> = {
  query: (_query, { signal }) => new Promise(resolve => {
    if (!signal.aborted) resolveServer = resolve;
  }),
};

function Fixture() {
  const [input, setInput] = React.useState({ rows: mode === 'populated' ? records : [], loading: mode === 'pending' || mode === 'custom' });
  admit = (count = records.length) => {
    const rows = records.slice(0, count);
    if (mode === 'server') resolveServer?.({ rows, page: { mode: 'offset', offset: 0, total: rows.length, hasMore: false } });
    else flushSync(() => setInput({ rows, loading: false }));
  };
  return <main style={{ width: 760 }}>
    <DataTable<RecordRow> schema={schema} source={mode === 'server'
      ? { type: 'server', table: 'records', adapter, prefetch: false, live: false }
      : { type: 'data', data: input.rows, isLoading: input.loading }}
      columns={['name', 'value']} paginated={{ pageSize: 10 }} liveUpdates={false} sortable={false}
      loadingState={mode === 'custom' ? <span>Custom loading content</span> : undefined}
      showToolbar={false} showExport={false} showColumnVisibility={false} />
  </main>;
}

declare global { interface Window { __initialRevealHarness: { admit(count?: number): void } } }
window.__initialRevealHarness = { admit: count => admit(count) };
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
