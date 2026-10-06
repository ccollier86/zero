/** Isolated record authoring fixture with deferred local writers; never opens an app/database. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { DataStudioMutationError, type DataStudioTable } from '../../frontend/client/data-studio-client';
import { DataStudioRowDialog } from './data-studio-row-dialog';

const INITIAL: DataStudioTable = {
  tableId: 'table-contacts', key: 'contacts', name: 'Contacts', description: 'People known to this workspace.',
  status: 'active', schemaRevision: 2, revision: 3, rowCount: 0, createdAt: 1, updatedAt: 2,
  schema: { version: 1, columns: [
    { columnId: 'name', key: 'name', label: 'Full name', type: 'text', required: true, description: 'Use the name shown on this contact’s profile.' },
    { columnId: 'score', key: 'score', label: 'Score', type: 'number', required: false, defaultValue: 2.5 },
    { columnId: 'due_on', key: 'due_on', label: 'Due date', type: 'date', required: false, defaultValue: '2026-02-03' },
    { columnId: 'meeting_at', key: 'meeting_at', label: 'Meeting at', type: 'datetime', required: false, defaultValue: '2026-02-03T17:45:37.123Z' },
    { columnId: 'active', key: 'active', label: 'Active', type: 'boolean', required: false, defaultValue: true },
    { columnId: 'consent', key: 'consent', label: 'Consent', type: 'boolean', required: true },
    { columnId: 'payload', key: 'payload', label: 'Metadata', type: 'json', required: false, defaultValue: { status: 'draft' } },
    { columnId: 'notes', key: 'notes', label: 'Notes', type: 'text', required: false },
  ] },
};
type Deferred = { id: number; tableId: string; sourceKey: string; values: Readonly<Record<string, unknown>>;
  settled: boolean; resolve: () => void; reject: (error: Error) => void };
let sequence = 0, rejectClose = false;
const writes: Deferred[] = [], events: { code: string; message: string; metadata?: Record<string, unknown> }[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push({ code: event.code, message: event.message, metadata: event.metadata }); } } });

function Fixture() {
  const [table, setTable] = React.useState<DataStudioTable | null>(INITIAL);
  const [sourceKey, setSourceKey] = React.useState('organization-a'), [open, setOpen] = React.useState(true);
  const [visible, setVisible] = React.useState(true), [busy, setBusy] = React.useState(false), [closes, setCloses] = React.useState(0);
  const current = React.useRef({ table, sourceKey }); current.current = { table, sourceKey };
  const writer = React.useCallback((values: Readonly<Record<string, unknown>>) => new Promise<void>((resolve, reject) => {
    writes.push({ id: ++sequence, tableId: current.current.table?.tableId ?? 'none', sourceKey: current.current.sourceKey,
      values, settled: false, resolve, reject });
  }), []);
  function settle(id: number, reject = false) {
    const operation = writes.find((write) => write.id === id && !write.settled);
    if (!operation) throw new Error('Missing fixture write.');
    operation.settled = true;
    if (reject) operation.reject(new Error('Synthetic create rejection')); else operation.resolve();
  }
  React.useEffect(() => {
    window.__rowDialog = {
      writes: () => writes.map(({ id, tableId, sourceKey, values, settled }) => ({ id, tableId, sourceKey, values, settled })),
      events: () => [...events], resolve: (id) => settle(id), reject: (id) => settle(id, true),
      rejectAmbiguous(id) {
        const operation = writes.find(write => write.id === id && !write.settled);
        if (!operation) throw new Error('Missing fixture write.');
        operation.settled = true;
        operation.reject(new DataStudioMutationError('Synthetic unconfirmed outcome', 'synthetic-operation', { requiresSameIdempotencyKey: true, retryable: true }));
      },
      switchTable() { setTable({ ...INITIAL, tableId: 'table-projects', key: 'projects', name: 'Projects' }); },
      schemaReplacement() { setTable((previous) => previous ? { ...previous, schemaRevision: previous.schemaRevision + 1,
        schema: { version: 1, columns: [{ columnId: 'project', key: 'project', label: 'Project title', type: 'text', required: true }] } } : null); },
      source: setSourceKey, busy: setBusy, reopen() { setOpen(true); }, unmount() { setVisible(false); },
      manyFields() { setTable((previous) => previous ? { ...previous, schemaRevision: previous.schemaRevision + 1,
        schema: { ...previous.schema, columns: [...INITIAL.schema.columns, ...Array.from({ length: 24 }, (_, index) => ({
          columnId: `field_${index}`, key: `field_${index}`, label: `Additional field ${index + 1}`, type: 'text' as const, required: false,
        }))] } } : null); },
      failClose() { rejectClose = true; },
    };
  }, []);
  return <main className="min-h-screen bg-background p-6 text-foreground">
    <h1 className="text-xl font-semibold">Contacts</h1>
    <p className="text-sm text-muted-foreground">Synthetic isolated record editor.</p>
    <output data-testid="row-closes" className="sr-only">{closes}</output>
    {visible && <DataStudioRowDialog open={open} table={table} busy={busy} scopeKey={sourceKey} onCreate={writer}
      onOpenChange={(next) => { if (!next) { setCloses((value) => value + 1); if (rejectClose) throw new Error('Synthetic private close notification'); } setOpen(next); }} />}
  </main>;
}
declare global {
  interface Window { __rowDialog: {
    writes(): { id: number; tableId: string; sourceKey: string; values: Readonly<Record<string, unknown>>; settled: boolean }[];
    events(): { code: string; message: string; metadata?: Record<string, unknown> }[];
    resolve(id: number): void; reject(id: number): void; rejectAmbiguous(id: number): void;
    switchTable(): void; schemaReplacement(): void; source(value: string): void; busy(value: boolean): void;
    reopen(): void; unmount(): void; manyFields(): void; failClose(): void;
  } }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
