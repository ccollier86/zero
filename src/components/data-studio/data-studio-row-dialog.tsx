'use client';

/** Standard managed frame around the existing acknowledged, scope-fenced record controller. */
import * as React from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { ControlledModal } from '../../modals/modal-controlled';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { DataStudioRowField } from './data-studio-row-field';
import { useDataStudioRowDialog } from './use-data-studio-row-dialog';
import type { ModalAction } from '../../modals/modal-system.types';
import type { DataStudioRowDialogProps } from './data-studio-row-dialog.types';
export type { DataStudioRowDialogProps } from './data-studio-row-dialog.types';

export function DataStudioRowDialog(props: DataStudioRowDialogProps) {
  const key = JSON.stringify([typeof props.scopeKey, props.scopeKey, props.table?.tableId, props.open]);
  const lifetime = React.useRef({ key, epoch: {} });
  if (lifetime.current.key !== key) lifetime.current = { key, epoch: {} };
  const owner = lifetime.current.epoch;
  return props.open && props.table ? <RowDialogSession key={key} {...props}
    isOwnerCurrent={() => lifetime.current.epoch === owner} /> : null;
}

function RowDialogSession(props: DataStudioRowDialogProps & { isOwnerCurrent(): boolean }) {
  const state = useDataStudioRowDialog(props), id = React.useId(), formId = 'row-' + id;
  const columns = state.opening.schema.columns;
  const required = columns.filter(column => column.required && !Object.hasOwn(column, 'defaultValue')).length;
  const action = (value: ModalAction): ModalAction => ({ ...value, closes: false });
  const actions: ModalAction[] = state.confirmation ? [
    action({ id: 'stay', label: 'Keep editing', variant: 'ghost', disabled: state.pending || props.busy, onClick: state.keepEditing }),
    action({ id: 'discard', label: state.confirmation === 'reload' ? 'Discard and reload' : state.uncertain ? 'Close form' : 'Discard draft',
      disabled: state.pending || props.busy, onClick: state.discard }),
    ...(state.confirmation === 'discard' && !state.uncertain ? [action({ id: 'create', label: 'Create record', variant: 'primary',
      submit: true, formId, disabled: state.blocked, onClick: state.save })] : []),
  ] : [
    { id: 'cancel', label: state.accepted ? 'Close' : 'Cancel', role: 'cancel', disabled: state.pending || props.busy },
    action({ id: 'create', label: state.pending ? 'Creating…' : state.accepted ? 'Created' : state.uncertain ? 'Retry request' : 'Create record',
      variant: 'primary', submit: true, formId, disabled: state.blocked, onClick: state.save }),
  ];
  const note = state.confirmation ? <div role="alert"><h4 className="font-semibold">
    {state.confirmation === 'reload' ? 'Reload the fields?' : state.uncertain ? 'Close without confirming the result?' : 'Discard this record draft?'}</h4>
    <p>{state.confirmation === 'reload' ? 'The values in this form will be cleared so you can use the updated fields.'
      : state.uncertain ? 'The request may have created a record. Check the table before adding it again.'
      : 'Your entered values will be lost. No record has been created.'}</p></div>
    : state.pending ? 'Creating your record…' : state.uncertain ? 'The exact request is kept for a safe retry.'
    : columns.some(column => Object.hasOwn(column, 'defaultValue')) ? 'Unchanged defaults are applied automatically.'
    : 'Values are saved only when you create the record.';
  return <ControlledModal open={props.open} identityKey={state.opening.tableId} onOpenChange={props.onOpenChange}
    busy={state.pending || props.busy} dirty={state.dirty} error={state.error}
    descriptor={{ title: 'Add record to ' + props.table?.name, icon: <Database />, size: 'lg',
      customSize: { width: 'var(--zero-data-studio-row-dialog-width,44rem)' }, dataSlot: 'data-studio-row-dialog',
      meta: <><Badge variant="outline">{columns.length} fields</Badge>{required > 0 && <span>{required} required without a default</span>}</>,
      description: 'Enter a value for each required field. Other fields are optional.',
      beforeClose: () => { state.requestClose(); return false; }, footer: { start: note }, actions,
      body: <form ref={state.formRef} id={formId} noValidate className="space-y-3">
        {state.schemaChanged && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div><p className="text-sm font-medium">The table fields changed</p><p className="text-xs text-muted-foreground">Your values are kept. Reload the fields before creating this record.</p></div>
          <Button type="button" variant="outline" size="sm" disabled={state.pending || props.busy || state.uncertain} onClick={state.requestReload}><RefreshCw />Reload fields</Button>
        </div>}
        {state.archived && <p role="status" className="text-muted-foreground">This table is archived. Restore it before adding records.</p>}
        <div data-slot="data-studio-row-dialog-fields" className="grid min-w-0 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          {columns.map(column => <DataStudioRowField key={column.columnId} column={column} draft={state.draft[column.columnId]}
            id={id + '-' + column.columnId} disabled={state.fieldsBlocked || state.confirmation !== null}
            error={state.fieldErrors[column.columnId]} onChange={raw => state.changeField(column.columnId, raw)} />)}
        </div>
      </form> }} />;
}
