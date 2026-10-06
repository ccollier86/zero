'use client';

/** Bind existing Studio dialogs to captured targets and acknowledged controller operations. */
import type { DataStudioRow, DataStudioTableStatus } from '../../frontend/client/data-studio-client';
import type { UseDataStudioResult } from '../../frontend/client/data-studio-hooks';
import { DataStudioConfirmDialog, DataStudioRowDialog, DataStudioTableDialog } from './data-studio-dialogs';

export interface DataStudioWorkspaceDialogsProps {
  controller: UseDataStudioResult;
  createTableOpen: boolean;
  onCreateTableOpen: (open: boolean) => void;
  schemaOpen: boolean;
  startWithNewColumn: boolean;
  onSchemaOpen: (open: boolean) => void;
  createRowOpen: boolean;
  onCreateRowOpen: (open: boolean) => void;
  deleteTarget: DataStudioRow | null;
  onDeleteClose: () => void;
  statusTarget: { status: DataStudioTableStatus; revision: number } | null;
  onStatusClose: () => void;
}

export function DataStudioWorkspaceDialogs({ controller: c, ...p }: DataStudioWorkspaceDialogsProps) {
  return <>
    <DataStudioTableDialog open={p.createTableOpen} busy={c.isMutating}
      maxColumns={c.capabilities?.limits.maxColumns}
      onOpenChange={p.onCreateTableOpen} onCreate={c.createTable} />
    <DataStudioTableDialog open={p.schemaOpen} table={c.selectedTable} busy={c.isMutating}
      maxColumns={c.capabilities?.limits.maxColumns}
      startWithNewColumn={p.startWithNewColumn} onOpenChange={p.onSchemaOpen} onUpdate={c.updateTable} />
    <DataStudioRowDialog open={p.createRowOpen} table={c.selectedTable} scopeKey={c.scopeKey} busy={c.isMutating}
      onOpenChange={p.onCreateRowOpen} onCreate={c.createRow} />
    <DataStudioConfirmDialog open={p.deleteTarget !== null} title="Delete this record?"
      operationKey={p.deleteTarget ? `${p.deleteTarget.rowId}:${p.deleteTarget.revision}` : undefined}
      description="This permanently removes the record. This action cannot be undone."
      confirmLabel="Delete record" destructive busy={c.isMutating}
      onOpenChange={open => { if (!open) p.onDeleteClose(); }}
      onConfirm={async () => { if (p.deleteTarget) await c.deleteRow(p.deleteTarget); }} />
    <DataStudioConfirmDialog open={p.statusTarget !== null}
      operationKey={p.statusTarget ? `${c.selectedTableId}:${p.statusTarget.status}:${p.statusTarget.revision}` : undefined}
      title={p.statusTarget?.status === 'archived' ? 'Archive this table?' : 'Restore this table?'}
      description={p.statusTarget?.status === 'archived'
        ? 'Records stay stored, but the table becomes read-only until restored.'
        : 'Make this table available for record changes again.'}
      confirmLabel={p.statusTarget?.status === 'archived' ? 'Archive table' : 'Restore table'}
      destructive={p.statusTarget?.status === 'archived'} busy={c.isMutating}
      onOpenChange={open => { if (!open) p.onStatusClose(); }}
      onConfirm={async () => { if (p.statusTarget) await c.changeTableStatus(p.statusTarget.status, { expectedRevision: p.statusTarget.revision }); }} />
  </>;
}
