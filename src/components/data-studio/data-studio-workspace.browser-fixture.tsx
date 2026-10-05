/** Synthetic controller composition only; no application credentials, services or databases. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataStudioWorkspace } from './data-studio-workspace';
import type { UseDataStudioResult } from '../../frontend/client/data-studio-hooks';
import type { DataStudioRow, DataStudioSchema, DataStudioTable, DataStudioTableUpdate } from '../../frontend/client/data-studio-client';

const initial: DataStudioTable = {
  tableId: 'contacts', name: 'Contacts', key: 'contacts', description: 'People and details for this workspace.',
  status: 'active', revision: 3, schemaRevision: 1, rowCount: 80, createdAt: 1, updatedAt: 1,
  schema: { version: 1, columns: [
    { columnId: 'name', key: 'name', label: 'Name', type: 'text', required: true },
    { columnId: 'score', key: 'score', label: 'Score', type: 'number', required: false },
    ...Array.from({ length: 12 }, (_, index) => ({ columnId: `note-${index}`, key: `note_${index}`,
      label: `Note ${index + 1}`, type: 'text' as const, required: false })),
  ] },
};
function records(scope: string, count = 80): DataStudioRow[] {
  return Array.from({ length: count }, (_, index) => ({ rowId: `row-${index}`, tableId: initial.tableId,
    revision: 1, schemaRevision: 1, createdAt: 1, updatedAt: 1,
    values: { name: `${scope} Person ${index}`, score: index,
      ...Object.fromEntries(Array.from({ length: 12 }, (_, note) => [`note-${note}`, `${scope} note ${note}: ${'A complete record value. '.repeat(20)}`])),
    } }));
}
type Operation = { type: string; revision?: number; row?: DataStudioRow; schema?: DataStudioSchema };
const operations: Operation[] = [];

function Fixture() {
  const [scope, setScope] = React.useState('one');
  const [table, setTable] = React.useState(initial);
  const [rows, setRows] = React.useState(() => records('one'));
  const [selected, select] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [sortColumnId, setSortColumnId] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [manage, setManage] = React.useState(true), [write, setWrite] = React.useState(true);
  const [refresh, setRefresh] = React.useState(false);
  const update = async (input: Omit<DataStudioTableUpdate, 'expectedRevision'>, options?: { expectedRevision: number }) => {
    operations.push({ type: 'table.update', revision: options?.expectedRevision, schema: input.schema });
    const next = { ...table, ...input, revision: table.revision + 1 } as DataStudioTable;
    setTable(next); return next;
  };
  const selectedIndex = rows.findIndex(row => row.rowId === selected);
  const controller: UseDataStudioResult = {
    scopeKey: scope, status: 'ready', access: { canRead: true, canWrite: write, canManage: manage },
    capabilities: { enabled: true, scope: 'organization', permissions: { read: true, write, manage },
      limits: { maxTables: 20, maxRowsPerTable: 1000, maxColumns: 50, maxPageSize: 25, maxRowBytes: 262144 } },
    tables: [table], selectedTableId: table.tableId, selectedTable: table, rows, totalRows: rows.length,
    selectedRowId: selected, selectedRow: selectedIndex < 0 ? null : rows[selectedIndex]!, selectedRowIndex: selectedIndex,
    tableStatus: 'active', search, filters: [], sortColumnId, sortDirection,
    offset: 0, previousOffset: null, nextOffset: null, pageSize: 25, rowWindowKey: `${scope}:${search}:${sortColumnId}:${sortDirection}`,
    isLoading: false, isLoadingRows: false, isMutating: false, error: null, mutationError: null,
    hasMoreRows: false, rowsNeedRefresh: refresh,
    selectTable() {}, selectRow: select,
    selectPreviousRow: () => select(rows[Math.max(0, selectedIndex - 1)]?.rowId ?? null),
    selectNextRow: () => select(rows[Math.min(rows.length - 1, selectedIndex + 1)]?.rowId ?? null),
    setTableStatus() {}, setSearch, setFilters() {}, setSort: (id, direction = 'asc') => { setSortColumnId(id); setSortDirection(direction); },
    setOffset() {}, goToPreviousPage: () => operations.push({ type: 'page.previous' }), goToNextPage: () => operations.push({ type: 'page.next' }),
    reload: async () => {}, reloadRows: async () => { setRefresh(false); },
    createTable: async input => ({ ...table, ...input }), updateTable: update,
    updateSchema: (schema, options) => update({ schema }, options),
    changeTableStatus: async (status, options) => {
      operations.push({ type: 'table.status', revision: options?.expectedRevision });
      const next = { ...table, status, revision: table.revision + 1 }; setTable(next); return next;
    },
    createRow: async () => records(scope, 1)[0]!,
    replaceRow: async row => row,
    updateCell: async (row, columnId, value) => {
      const next = { ...row, revision: row.revision + 1, values: { ...row.values, [columnId]: value } };
      setRows(current => current.map(old => old.rowId === row.rowId ? next : old)); return next;
    },
    deleteRow: async row => { operations.push({ type: 'row.delete', row }); setRows(current => current.filter(old => old.rowId !== row?.rowId)); },
  };
  window.__studioWorkspace = {
    operations: () => [...operations], empty: () => { select(null); setRows([]); }, select,
    revision: () => { setTable(current => ({ ...current, revision: current.revision + 1 })); setRows(current => current.map(row => ({ ...row, revision: row.revision + 1 }))); },
    scope: next => { setScope(next); select(null); setRows(records(next)); },
    permissions: (manager, writer) => { setManage(manager); setWrite(writer); }, refresh: setRefresh,
  };
  return <main className="flex h-svh min-h-0 flex-col bg-background p-3 text-foreground sm:p-5">
    <DataStudioWorkspace controller={controller} title="Workspace tables" />
  </main>;
}
declare global {
  interface Window { __studioWorkspace: {
    operations(): Operation[]; empty(): void; select(id: string): void; revision(): void; scope(next: string): void;
    permissions(manager: boolean, writer: boolean): void; refresh(required: boolean): void;
  }; }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
