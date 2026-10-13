/** Isolated actual DataTable scroll ownership and motion fixture; no SDK or app config. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableServerAdapter } from './data-table-server-types';

const schema = defineSchema({ name: field.text(), detail: field.text(), result: field.text() });
type RecordRow = { id: string; name: string; detail: string; result: string };
const wide = document.documentElement.dataset.wide === 'true';
const server = document.documentElement.dataset.server === 'true';
const records: RecordRow[] = Array.from({ length: 24 }, (_, index) => ({ id: `row-${index}`,
  name: `Record ${index}`, detail: wide ? `Very-long-unbroken-record-detail-value-${index}` : 'Detail',
  result: wide ? `Very-long-unbroken-record-result-value-${index}` : 'Result' }));
let resolve: () => void;
let chrome: (visible: boolean) => void;
let held = false, release: (() => void) | null = null;
const adapter: DataTableServerAdapter<RecordRow> = {
  query: (query, { signal }) => new Promise((resolve, reject) => {
    const offset = query.pagination.pageIndex * query.pagination.pageSize;
    const finish = () => {
      signal.removeEventListener('abort', abort);
      if (release === finish) release = null;
      resolve({ rows: records.slice(offset, offset + query.pagination.pageSize),
        page: { mode: 'offset', offset, total: records.length, hasMore: offset + query.pagination.pageSize < records.length } });
    };
    const abort = () => { if (release === finish) release = null; reject(new DOMException('Synthetic read retired', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    if (held) { release = finish; signal.addEventListener('abort', abort, { once: true }); }
    else finish();
  }),
};
function Fixture() {
  const [loading, setLoading] = React.useState(document.documentElement.dataset.loading === 'true');
  const [showHorizontalScrollbar, setChrome] = React.useState(document.documentElement.dataset.chrome === 'true');
  resolve = () => setLoading(false); chrome = setChrome;
  return <section data-overflow-fixture style={{ width: wide ? 330 : 700, maxWidth: '100%' }}>
    <DataTable<RecordRow> schema={schema} source={server
      ? { type: 'server', table: 'synthetic-records', adapter, prefetch: false, live: false }
      : { type: 'data', data: loading ? [] : records, isLoading: loading }}
      columns={['name', 'detail', 'result']} showToolbar={false} paginated={{ pageSize: 10 }}
      showHorizontalScrollbar={showHorizontalScrollbar} tableLayout={wide ? 'auto' : 'fixed'}
      columnOverrides={wide ? {
        name: { cell: ({ value }) => <button type="button">{String(value)}</button> },
        detail: { cell: ({ value }) => <button type="button" style={{ whiteSpace: 'nowrap' }}>{String(value)}</button> },
        result: { cell: ({ value }) => <button type="button" style={{ whiteSpace: 'nowrap' }}>{String(value)}</button> },
      } : { name: { flex: true }, detail: { width: 140 }, result: { width: 140 } }} />
  </section>;
}
declare global {
  interface Window { __tableOverflow: { resolve(): void; chrome(visible: boolean): void; holdPageReads(value: boolean): void; releasePage(): void } }
}
window.__tableOverflow = { resolve: () => resolve(), chrome: visible => chrome(visible),
  holdPageReads: value => { held = value; }, releasePage: () => { held = false; release?.(); } };
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
