/** Real standalone DataTable cell-presentation fixture; caller-owned rows only, with no client, transport, or database. */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableProps } from './data-table-types';

type CellRow = {
  id: string;
  name: string | null;
  editable: string;
  custom: string;
  masked: string;
  password: string;
  hiddenPassword: string;
  count: number;
  date: string;
  choice: string;
};

const schema = defineSchema({ name: field.text(), editable: field.text(), custom: field.text(), masked: field.text(),
  password: field.password(), hiddenPassword: field.password(), count: field.number(), date: field.date(),
  choice: field.enum(['one', 'two']) });
const columns = ['name', 'editable', 'custom', 'masked', 'password', 'count', 'date', 'choice'];
const overrides: NonNullable<DataTableProps<CellRow>['columnOverrides']> = {
  custom: { cell: () => <span data-testid="custom-renderer">Custom presentation</span> },
  masked: { cell: () => <span data-testid="masked-renderer" aria-label="Masked value">••••••••</span> },
  password: { cell: () => <span data-testid="password-renderer" aria-label="Protected password">••••••••</span> },
};
const initial: CellRow = { id: 'existing', name: null, editable: 'Editable original', custom: 'PRIVATE_CUSTOM_ORIGINAL',
  masked: 'PRIVATE_MASKED_ORIGINAL', password: 'PRIVATE_PASSWORD_ORIGINAL', hiddenPassword: 'PRIVATE_HIDDEN_PASSWORD',
  count: 7, date: '2026-10-01', choice: 'one' };
let updateRow: (patch: Partial<CellRow>) => void;
let configureMotion: (mode: DataTableProps<CellRow>['cellMotion']) => void;
let commits = 0;
let savedRow: Element | null = null, savedHelper: Element | null = null, savedEditor: Element | null = null;

function currentRow() { return document.querySelector('[data-row-id="existing"]'); }

function Fixture() {
  const [rows, setRows] = React.useState([initial]);
  const [cellMotion, setCellMotion] = React.useState<DataTableProps<CellRow>['cellMotion']>(undefined);
  updateRow = patch => flushSync(() => setRows(previous => previous.map(row => ({ ...row, ...patch }))));
  configureMotion = mode => flushSync(() => setCellMotion(mode));
  const commit = React.useCallback((_id: string, column: string, value: unknown) => {
    commits++;
    setRows(previous => previous.map(row => ({ ...row, [column]: value })));
  }, []);
  return <main style={{ width: 1100 }}>
    <DataTable<CellRow> schema={schema} data={rows} columns={columns} editable={['editable']}
      columnOverrides={overrides} cellMotion={cellMotion} liveUpdates={false} sortable={false}
      showToolbar={false} showExport={false} showColumnVisibility={false} onCellCommit={commit} />
  </main>;
}

declare global { interface Window { __dataTableCellMotion: {
  update(patch: Partial<CellRow>): { canonical: string; visual: string | null; typing: boolean };
  mode(mode: DataTableProps<CellRow>['cellMotion']): void;
  capture(): void;
  same(): { row: boolean; helper: boolean; editor: boolean };
  commits(): number;
} } }

window.__dataTableCellMotion = {
  update: patch => {
    updateRow(patch);
    const cell = currentRow()?.querySelector('td');
    return { canonical: cell?.querySelector('[data-slot="typing-text-value"]')?.textContent ?? '',
      visual: cell?.querySelector('[data-slot="typing-text-visual"]')?.textContent ?? null,
      typing: cell?.querySelector('[data-typing]') != null };
  },
  mode: mode => configureMotion(mode),
  capture: () => {
    savedRow = currentRow(); savedHelper = savedRow?.querySelector('[data-slot="data-table-animated-text"]') ?? null;
    savedEditor = savedRow?.querySelector('[data-slot="editable-cell-editor"] input') ?? null;
  },
  same: () => ({ row: savedRow === currentRow(),
    helper: savedHelper === currentRow()?.querySelector('[data-slot="data-table-animated-text"]'),
    editor: savedEditor === currentRow()?.querySelector('[data-slot="editable-cell-editor"] input') }),
  commits: () => commits,
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
