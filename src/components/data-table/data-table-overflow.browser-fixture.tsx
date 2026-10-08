/** Isolated actual DataTable scroll ownership and motion fixture; no SDK or app config. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';

const schema = defineSchema({ name: field.text(), detail: field.text(), result: field.text() });
type RecordRow = { id: string; name: string; detail: string; result: string };
const wide = document.documentElement.dataset.wide === 'true';
const records: RecordRow[] = Array.from({ length: 24 }, (_, index) => ({ id: `row-${index}`,
  name: `Record ${index}`, detail: wide ? `Very-long-unbroken-record-detail-value-${index}` : 'Detail',
  result: wide ? `Very-long-unbroken-record-result-value-${index}` : 'Result' }));
let resolve: () => void;
let chrome: (visible: boolean) => void;
function Fixture() {
  const [loading, setLoading] = React.useState(document.documentElement.dataset.loading === 'true');
  const [showHorizontalScrollbar, setChrome] = React.useState(document.documentElement.dataset.chrome === 'true');
  resolve = () => setLoading(false); chrome = setChrome;
  return <section data-overflow-fixture style={{ width: wide ? 330 : 700, maxWidth: '100%' }}>
    <DataTable<RecordRow> schema={schema} source={{ type: 'data', data: loading ? [] : records, isLoading: loading }}
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
  interface Window { __tableOverflow: { resolve(): void; chrome(visible: boolean): void } }
}
window.__tableOverflow = { resolve: () => resolve(), chrome: visible => chrome(visible) };
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
