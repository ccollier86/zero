/** Deterministic harness for full-table query, selection, and layout regressions. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableServerQuery, DataTableServerResult } from './data-table-server-types';
import type { DataTableState } from './data-table-state';

type FixtureRow = { id: string; name: string; value?: string };
const schema = defineSchema({ name: field.text(), value: field.text() });
const queries: DataTableServerQuery[] = [];
const pending = new Map<number, { signal: AbortSignal; resolve(value: DataTableServerResult<FixtureRow>): void }>();
const adapter = {
  query(query: DataTableServerQuery, { signal }: { signal: AbortSignal }) {
    const index = queries.push(structuredClone(query)) - 1;
    return new Promise<DataTableServerResult<FixtureRow>>((resolve) => pending.set(index, { signal, resolve }));
  },
};
const alternativeAdapter = { query: adapter.query };
let setTable: (name: string) => void;
type FixtureMode = 'offset' | 'cursor' | 'layout' | 'edit';
let setMode: (mode: FixtureMode) => void;
let setControls: React.Dispatch<React.SetStateAction<Partial<DataTableState>>>;
let replaceAdapter: () => void;
let selectionChanges = 0;
let lastSelection: string[] = [];
let commits = 0;
let automaticWrites = 0;
let refreshes = 0;
let acceptWrite: () => void;
let acceptRefresh: () => void;
let rejectRefresh: () => void;

function LayoutValue() {
  const [revealed, setRevealed] = React.useState(false);
  return <span><button onClick={() => setRevealed(!revealed)}>Reveal secret</button>{revealed ? 'x'.repeat(1500) : '••••••••'}</span>;
}

function Fixture() {
  const [table, updateTable] = React.useState('records');
  const [mode, updateMode] = React.useState<FixtureMode>('offset');
  const [controls, updateControls] = React.useState<Partial<DataTableState>>({});
  const [alternate, updateAlternate] = React.useState(false);
  const [editedValue, updateEditedValue] = React.useState('before-edit');
  const [, updateSelection] = React.useState<string[]>([]);
  setTable = updateTable;
  setMode = updateMode;
  setControls = updateControls;
  replaceAdapter = () => updateAlternate((previous) => !previous);
  return <div style={{ width: 650 }}>
    {mode === 'layout' ? <DataTable schema={schema} data={[{ id: '1', name: 'Key', value: 'masked' }]}
      tableLayout="fixed" columnOverrides={{ name: { width: 150 }, value: { flex: true, truncate: true, cell: () => <LayoutValue /> } }} />
      : mode === 'edit' ? <DataTable<FixtureRow> schema={schema} columns={['name']} editable={['name']}
        source={{ type: 'data', data: [{ id: '1', name: editedValue }],
          actions: { update: () => { automaticWrites++; } },
          refresh: () => { refreshes++; return new Promise<void>((resolve, reject) => {
            acceptRefresh = resolve; rejectRefresh = () => reject(new Error('private raw refresh detail'));
          }); } }}
        onCellCommit={(_id, _field, value) => { commits++; return new Promise<void>((resolve) => {
          acceptWrite = () => { updateEditedValue(String(value)); resolve(); };
        }); }} />
      : <DataTable<FixtureRow> schema={schema} source={{ type: 'server', table, pagination: mode, adapter: alternate ? alternativeAdapter : adapter, prefetch: false }}
        columns={['name']} searchable={{ fields: ['name'], ariaLabel: 'Search records' }} paginated={{ pageSize: 2 }}
        selectable state={controls} onStateChange={updateControls}
        onSelectionChange={(ids) => { selectionChanges++; lastSelection = ids; updateSelection(ids); }}
        showExport={false} showColumnVisibility={false} />}
  </div>;
}

declare global {
  interface Window {
    __fullTableHarness: {
      queries(): DataTableServerQuery[];
      resolve(index: number, result: DataTableServerResult<FixtureRow>): void;
      aborted(index: number): boolean;
      table(name: string): void;
      mode(mode: FixtureMode): void;
      controls(state: Partial<DataTableState>): void;
      replaceAdapter(): void;
      selection(): string[];
      selectionChanges(): number;
      editCounts(): { commits: number; automaticWrites: number; refreshes: number };
      acceptWrite(): void;
      acceptRefresh(): void;
      rejectRefresh(): void;
    };
  }
}

window.__fullTableHarness = {
  queries: () => queries,
  resolve: (index, result) => pending.get(index)?.resolve(result),
  aborted: (index) => pending.get(index)?.signal.aborted ?? false,
  table: (name) => setTable(name),
  mode: (mode) => setMode(mode),
  controls: (state) => setControls(state),
  replaceAdapter: () => replaceAdapter(),
  selection: () => lastSelection,
  selectionChanges: () => selectionChanges,
  editCounts: () => ({ commits, automaticWrites, refreshes }),
  acceptWrite: () => acceptWrite(),
  acceptRefresh: () => acceptRefresh(),
  rejectRefresh: () => rejectRefresh(),
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
