/** Synthetic in-memory grid acceptance fixture; no SDK, Guardian, database or provider starts. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataStudioGrid } from './data-studio-grid';
import { DataStudioMutationError, type DataStudioColumn, type DataStudioRow, type DataStudioTable, type DataStudioValue } from '../../frontend/client/data-studio-client';

const initial: DataStudioTable = { tableId: 'table-1', key: 'contacts', name: 'Contacts',
  description: null, status: 'active', revision: 3, schemaRevision: 1, rowCount: 1000,
  createdAt: 1, updatedAt: 1, schema: { version: 1, columns: [
    { columnId: 'name', key: 'name', label: 'Name', type: 'text', required: true },
    { columnId: 'score', key: 'score', label: 'Score', type: 'number', required: false },
    { columnId: 'flag', key: 'flag', label: 'Flag', type: 'boolean', required: false },
  ] } };
const makeRows = (count: number): DataStudioRow[] => Array.from({ length: count }, (_, index) => ({
  rowId: `row-${index}`, tableId: initial.tableId, schemaRevision: 1, revision: 1,
  values: { name: `Person ${index}`, score: index, flag: false }, createdAt: 1, updatedAt: 1,
}));
type Operation = { type: string; id?: string; direction?: string; revision?: number; column?: DataStudioColumn };
const operations: Operation[] = [];
let release: (() => void) | null = null;
let mode: 'normal' | 'held' | 'error' = 'normal';
async function gate() {
  if (mode === 'held') await new Promise<void>(resolve => { release = resolve; });
  if (mode === 'error') throw new Error('Synthetic write rejection');
}

function Fixture() {
  const [table, setTable] = React.useState(initial);
  const tableRef = React.useRef(table); tableRef.current = table;
  const [rows, setRows] = React.useState(() => makeRows(1000));
  const [manager, setManager] = React.useState(true);
  const [writer, setWriter] = React.useState(true);
  const [selected, select] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(true);
  const [more, setMore] = React.useState(false);
  const [refresh, setRefresh] = React.useState(false);
  const [queryKey, setQueryKey] = React.useState('initial');
  const update = async (column: DataStudioColumn, revision?: number) => {
    operations.push({ type: 'update', id: column.columnId, revision, column });
    await gate();
    if (revision !== tableRef.current.revision) throw new DataStudioMutationError('Synthetic revision conflict', 'fixture', { code: 'DATA_STUDIO_REVISION_CONFLICT' });
    setTable(current => ({ ...current, revision: current.revision + 1,
      schema: { ...current.schema, columns: current.schema.columns.map(old => old.columnId === column.columnId ? column : old) } }));
  };
  const commit = async (row: DataStudioRow, column: DataStudioColumn, value: DataStudioValue) => {
    operations.push({ type: 'commit', id: row.rowId }); await gate();
    setRows(current => current.map(old => old.rowId === row.rowId ? { ...old, revision: old.revision + 1,
      values: { ...old.values, [column.columnId]: value } } : old));
  };
  window.__studioGrid = {
    operations: () => [...operations], count: count => { select(null); setRows(makeRows(count)); },
    permissions: (manage, write) => { setManager(manage); setWriter(write); },
    mode: next => { mode = next; }, release: () => { release?.(); release = null; },
    revision: () => setTable(current => ({ ...current, revision: current.revision + 1 })),
    select, visible: setVisible, progressive: value => { setMore(value); }, refresh: setRefresh,
    table: () => tableRef.current, query: value => { select(null); setQueryKey(value); },
    columns: count => setTable(current => ({ ...current, schema: { ...current.schema, columns: initial.schema.columns.slice(0, count) } })),
  };
  return <div className="flex h-[360px] w-[580px] flex-col border bg-background text-foreground">
    {visible && <DataStudioGrid table={table} rows={rows} selectedRowId={selected} editable={writer}
      schemaEditable={manager} onSelectRow={select} onCommit={commit} onReload={async () => { operations.push({ type: 'reload' }); }}
      onAddColumn={() => operations.push({ type: 'add' })} onUpdateColumn={update}
      onMoveColumn={async (id, direction, revision) => { operations.push({ type: 'move', id, direction, revision }); }}
      onRemoveColumn={async (id, revision) => { operations.push({ type: 'remove', id, revision }); await gate(); }}
      onSort={(id, direction) => operations.push({ type: 'sort', id, direction })}
      queryKey={queryKey} hasMore={more} refreshRequired={refresh} onLoadMore={async () => { operations.push({ type: 'load' }); await gate(); setMore(false); }} />}
  </div>;
}

declare global {
  interface Window { __studioGrid: {
    operations(): Operation[]; count(count: number): void; permissions(manage: boolean, write: boolean): void;
    mode(mode: 'normal' | 'held' | 'error'): void; release(): void; revision(): void;
    select(id: string): void; visible(visible: boolean): void; progressive(more: boolean): void;
    refresh(value: boolean): void; table(): DataStudioTable;
    query(value: string): void; columns(count: number): void;
  }; }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
