'use client';

/** Schema-aware grid headings own anchored editing, menu focus transfer and accepted action UI. */
import * as React from 'react';
import type { Header } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Calendar, CalendarClock, Hash, Braces, ToggleLeft, Type, LoaderCircle } from 'lucide-react';
import { isDataStudioMutationError, isDataStudioRevisionConflict,
  type DataStudioColumn, type DataStudioRow } from '../../frontend/client/data-studio-client';
import { reportDataStudioFrontendFailure } from '../../frontend/client/data-studio-observability';
import { TableHead } from '../ui/table';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../animate-ui/components/radix/popover';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel } from '../animate-ui/components/radix/alert-dialog';
import { DataStudioColumnEditor } from './data-studio-column-editor';
import { editableDataStudioColumn } from './data-studio-schema-draft';
import { DataStudioColumnMenu } from './data-studio-column-menu';
import { DataStudioColumnResize } from './data-studio-column-resize';

export interface DataStudioSchemaActions {
  readonly schemaEditable?: boolean;
  readonly onAddColumn?: () => void;
  readonly onUpdateColumn?: (next: DataStudioColumn, expectedRevision?: number) => Promise<unknown>;
  readonly onMoveColumn?: (columnId: string, direction: 'left' | 'right', expectedRevision?: number) => Promise<unknown>;
  readonly onRemoveColumn?: (columnId: string, expectedRevision?: number) => Promise<unknown>;
}

const TYPE_ICONS = { text: Type, number: Hash, boolean: ToggleLeft,
  date: Calendar, datetime: CalendarClock, json: Braces };

export function DataStudioColumnHeader({ column, index, count, resizeHeader, onWidthChange,
  sorted, sortDirection, onSort, tableRevision, schemaEditable = false, onUpdateColumn,
  onMoveColumn, onRemoveColumn }: DataStudioSchemaActions & {
  column: DataStudioColumn; index: number; count: number; resizeHeader: Header<DataStudioRow, unknown>;
  tableRevision: number;
  onWidthChange: (width: number) => void; sorted: boolean;
  sortDirection: 'asc' | 'desc'; onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(() => editableDataStudioColumn(column));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const admitted = React.useRef(false);
  const editRevision = React.useRef(tableRevision);
  const editCommit = React.useRef(onUpdateColumn);
  const removal = React.useRef({ revision: tableRevision, commit: onRemoveColumn });
  const mounted = React.useRef(false);
  const allowed = React.useRef(schemaEditable); allowed.current = schemaEditable;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editable = schemaEditable && !!onUpdateColumn;
  const run = async (action: () => Promise<unknown>) => {
    if (admitted.current || !mounted.current || !allowed.current) return false;
    admitted.current = true; setPending(true); setError(null);
    try {
      await action(); return mounted.current;
    } catch (cause) {
      reportDataStudioFrontendFailure('table.update', 'mutation', cause);
      if (mounted.current) setError(isDataStudioMutationError(cause) && cause.requiresSameIdempotencyKey
        ? 'The outcome is unconfirmed. Reconcile the pending operation before retrying.'
        : isDataStudioRevisionConflict(cause)
          ? 'The schema changed elsewhere. Reload before applying again.'
          : 'The column change was not accepted. Review the settings before trying again.');
      return false;
    } finally {
      admitted.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const openEditor = () => {
    if (!editable || !allowed.current || !mounted.current || admitted.current) return;
    editRevision.current = tableRevision; editCommit.current = onUpdateColumn;
    setDraft(editableDataStudioColumn(column)); setError(null); setEditorOpen(true);
  };
  const Icon = TYPE_ICONS[column.type];
  const SortIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;
  return <TableHead data-column-id={column.columnId}
    className="relative h-10 border-r border-border/60 px-2 text-xs last:border-r-0"
    style={{ width: resizeHeader.getSize() }} aria-sort={sorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}>
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={editorOpen} onOpenChange={(open) => {
        if (pending) return;
        if (open) openEditor(); else setEditorOpen(false);
      }}>
        <PopoverTrigger asChild>
          <button type="button" disabled={!editable || pending}
            aria-label={`Edit ${column.label} column`} title={`${column.label} · ${column.type}${column.required ? ' · required' : ''}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate font-medium">{column.label}</span>
            {column.required && <span aria-label="Required" className="text-primary">*</span>}
            {sorted && <SortIcon className="size-3 shrink-0 text-primary" aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3"
          onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
          onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
          <DataStudioColumnEditor column={draft} onChange={setDraft}
            disabled={pending || !schemaEditable} onCancel={() => setEditorOpen(false)} applyLabel={pending ? 'Saving…' : 'Apply changes'}
            onApply={async (next) => {
              const commit = editCommit.current;
              if (!commit || next.columnId !== column.columnId) return;
              if (await run(() => commit(next, editRevision.current))) setEditorOpen(false);
            }} />
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        </PopoverContent>
      </Popover>
      <DataStudioColumnMenu label={column.label} open={menuOpen} onOpenChange={setMenuOpen}
        editable={editable} sortable={!!onSort && column.type !== 'json'} pending={pending}
        canMoveLeft={index > 0 && !!onMoveColumn} canMoveRight={index < count - 1 && !!onMoveColumn}
        canRemove={!!onRemoveColumn}
        onSort={(direction) => onSort?.(column.columnId, direction)}
        onMove={(direction) => {
          const revision = tableRevision, commit = onMoveColumn;
          if (commit) void run(() => commit(column.columnId, direction, revision));
        }}
        onIntent={(intent) => {
          if (intent === 'edit') openEditor();
          else if (schemaEditable) {
            removal.current = { revision: tableRevision, commit: onRemoveColumn };
            setError(null); setRemoveOpen(true);
          }
        }} />
      {pending && <LoaderCircle className="size-3 animate-spin text-muted-foreground" aria-label="Updating column" />}
    </div>
    {!editorOpen && !removeOpen && error && <span role="alert" className="sr-only">{error}</span>}
    <DataStudioColumnResize label={column.label} header={resizeHeader} onChange={onWidthChange} />
    <AlertDialog open={removeOpen} onOpenChange={(open) => { if (!pending) setRemoveOpen(open); }}>
      <AlertDialogContent>
        <AlertDialogTitle>Remove {column.label}?</AlertDialogTitle>
        <AlertDialogDescription>This removes the column from the schema. Review dependent functions and saved values before applying this change.</AlertDialogDescription>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending || !schemaEditable || !onRemoveColumn}
            onClick={() => {
              const { commit, revision } = removal.current;
              if (commit) void run(() => commit(column.columnId, revision)).then((accepted) => { if (accepted) setRemoveOpen(false); });
            }}>
            {pending ? 'Removing…' : 'Remove column'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </TableHead>;
}
