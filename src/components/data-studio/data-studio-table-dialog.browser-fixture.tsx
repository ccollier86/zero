/** Synthetic table/JSON editing harness; callbacks never touch SDKs, auth, database or storage. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataStudioTableDialog } from './data-studio-table-dialog';
import { DataStudioConfirmDialog } from './data-studio-confirm-dialog';
import { JsonEditor, type JsonEditorHandle } from '../json-editor';
import type { DataStudioSchema, DataStudioTable } from '../../frontend/client/data-studio-client';
import { configureFrontendObservability } from '../../frontend/client/observability';

const initial: DataStudioTable = { tableId: 'contacts', name: 'Contacts', key: 'contacts', description: null,
  revision: 3, schemaRevision: 1, rowCount: 0, createdAt: 1, updatedAt: 1, status: 'active', schema: {
    version: 1, columns: [
      { columnId: 'column_name', key: 'name', label: 'Name', type: 'text', required: false },
      { columnId: 'column_score', key: 'score', label: 'Score', type: 'number', required: false },
    ],
  } };
const operations: { schema: DataStudioSchema; name: string; revision?: number }[] = [];
const observed: unknown[] = [];
configureFrontendObservability({ sink: { emit: event => { observed.push(event); } } });
let resolve: (() => void) | undefined, reject: (() => void) | undefined;
let hold = false, failClose = false, throwEditing = false;
let closes = 0;
function Fixture() {
  const [table, setTable] = React.useState<DataStudioTable | null>(initial);
  const [open, setOpen] = React.useState(true), [visible, setVisible] = React.useState(true);
  const [add, setAdd] = React.useState(false), [view, setView] = React.useState<'table' | 'json' | 'confirm'>('table');
  const [operationKey, setOperationKey] = React.useState('first');
  const [maxColumns, setMaxColumns] = React.useState<number | undefined>(undefined);
  const [disabled, setDisabled] = React.useState(false);
  const [value, setValue] = React.useState<unknown>({ name: 'Original' });
  const [raw, setRaw] = React.useState<string | null>(null);
  const valueRef = React.useRef(value); valueRef.current = value;
  const rawRef = React.useRef(raw); rawRef.current = raw;
  const editor = React.useRef<JsonEditorHandle<unknown>>(null);
  const writer = async (input: { name: string; schema: DataStudioSchema }, options?: { expectedRevision: number }) => {
    operations.push({ name: input.name, schema: input.schema, revision: options?.expectedRevision });
    if (hold) await new Promise<void>((success, failure) => { resolve = success; reject = () => failure(new Error('Synthetic save rejection')); });
  };
  window.__studioDialog = {
    operations: () => operations, closes: () => closes, observed: () => observed,
    hold: () => { hold = true; }, resolve: () => resolve?.(), reject: () => reject?.(),
    revision: () => setTable(current => current ? { ...current, revision: current.revision + 1 } : null),
    switchTable: () => setTable({ ...initial, tableId: 'other', name: 'Other' }),
    reopen: () => setOpen(true), unmount: () => setVisible(false), create: () => setTable(null),
    addColumn: () => { setOpen(false); setAdd(true); requestAnimationFrame(() => setOpen(true)); },
    failClose: () => { failClose = true; },
    json: () => setView('json'), raw: () => rawRef.current, value: () => valueRef.current,
    confirmation: () => setView('confirm'), replaceConfirmation: () => setOperationKey('second'),
    limit: setMaxColumns, disable: () => setDisabled(true),
    commit: () => editor.current?.commit(), throwEditing: () => { throwEditing = true; },
  };
  return visible && (view === 'table' ? <DataStudioTableDialog open={open} table={table} startWithNewColumn={add} maxColumns={maxColumns}
    onCreate={writer} onUpdate={writer} onOpenChange={next => {
      if (!next) closes++;
      if (failClose) throw new Error('Synthetic close callback rejection');
      setOpen(next);
    }} /> : view === 'confirm' ? <DataStudioConfirmDialog open={open} operationKey={operationKey}
      title="Archive table" description="Synthetic confirmation only." confirmLabel="Archive"
      onConfirm={() => writer({ name: operationKey, schema: initial.schema })}
      onOpenChange={next => { if (!next) closes++; setOpen(next); }} />
      : <JsonEditor value={value} onChange={setValue} editorRef={editor} label="Test JSON" disabled={disabled}
      rawTextDraft={raw} onRawTextDraftChange={setRaw}
      onEditingChange={() => { if (throwEditing) throw new Error('Synthetic private callback content'); }} />);
}
declare global {
  interface Window { __studioDialog: {
    operations(): { schema: DataStudioSchema; name: string; revision?: number }[];
    closes(): number; observed(): unknown[]; hold(): void; resolve(): void; reject(): void;
    revision(): void; switchTable(): void; reopen(): void; unmount(): void; create(): void; addColumn(): void; failClose(): void;
    json(): void; raw(): string | null; value(): unknown; commit(): unknown; throwEditing(): void;
    confirmation(): void; replaceConfirmation(): void;
    limit(value: number): void; disable(): void;
  }; }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
