'use client';

/** Shared modal anatomy; the table controller retains schema/revision/write ownership. */
import * as React from 'react';
import { Database } from 'lucide-react';
import { ControlledModal } from '../../modals/modal-controlled';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { DataStudioDialogField as Field } from './data-studio-dialog-field';
import { normalizeDataStudioKey } from './data-studio-schema-draft';
import { DataStudioSchemaEditor } from './data-studio-schema-editor';
import { useDataStudioTableDialog } from './use-data-studio-table-dialog';
import type { ModalAction } from '../../modals/modal-system.types';
import type { DataStudioTableDialogProps } from './data-studio-table-dialog.types';
export type { DataStudioTableDialogProps } from './data-studio-table-dialog.types';

export function DataStudioTableDialog(props: DataStudioTableDialogProps) {
  return props.open ? <TableDialogSession key={props.table?.tableId ?? '__create'} {...props} /> : null;
}
function TableDialogSession(props: DataStudioTableDialogProps) {
  const state = useDataStudioTableDialog(props), editing = Boolean(state.opening.table), id = React.useId(), formId = 'table-' + id;
  const controlsBlocked = state.blocked || state.accepted || state.impact.length > 0;
  const action = (value: ModalAction): ModalAction => ({ ...value, closes: false });
  const actions: ModalAction[] = state.impact.length > 0 ? [
    action({ id: 'stay', label: 'Keep editing', disabled: state.blocked, onClick: () => state.setImpact([]) }),
    action({ id: 'confirm-save', label: 'Confirm and save', variant: 'primary', disabled: state.blocked, onClick: () => state.save(true) }),
  ] : state.confirmClose ? [
    action({ id: 'stay', label: 'Keep editing', variant: 'ghost', disabled: state.blocked, onClick: () => state.setConfirmClose(false) }),
    action({ id: 'discard', label: 'Discard changes', disabled: state.blocked, onClick: state.discard }),
    action({ id: 'save', label: state.pending ? 'Saving…' : 'Save changes', variant: 'primary', disabled: state.blocked, onClick: () => state.save() }),
  ] : [
    { id: 'cancel', label: 'Cancel', role: 'cancel', disabled: state.blocked },
    action({ id: 'save', label: state.pending ? 'Saving…' : state.accepted ? 'Saved' : editing ? 'Save changes' : 'Create table',
      variant: 'primary', submit: true, formId, disabled: state.blocked || state.accepted, onClick: () => state.save() }),
  ];
  const note = state.impact.length > 0 ? <div role="alert"><h4 className="font-semibold">Review schema changes</h4>
    <p>Existing data and caller compatibility are checked again on the server. This does not migrate or delete stored values.</p>
    <ul className="max-h-24 list-disc overflow-y-auto pl-5">{state.impact.map(item => <li key={item}>{item}</li>)}</ul></div>
    : state.confirmClose ? <div role="alert"><h4 className="font-semibold">Save your changes?</h4><p>Your draft will be discarded if you leave without saving.</p></div>
    : undefined;
  return <ControlledModal open={props.open} onOpenChange={props.onOpenChange} identityKey={props.table?.tableId ?? '__create'}
    busy={state.blocked} dirty={state.dirty} error={state.error}
    descriptor={{ title: editing ? 'Edit table' : 'Create table', icon: <Database />, size: 'xl',
      customSize: { width: 'var(--zero-data-studio-table-dialog-width,68rem)' }, dataSlot: 'data-studio-table-dialog',
      description: 'Define fields once, then use them from your functions, workflows and APIs.',
      beforeClose: () => { state.requestClose(); return false; }, footer: { start: note }, actions,
      body: <form id={formId} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Table name" htmlFor={id + '-name'}><Input id={id + '-name'} data-slot="data-studio-table-name" value={state.name}
            disabled={controlsBlocked} placeholder="Contacts, tasks, customers…" onChange={event => {
              const next = event.target.value; state.setName(next);
              if (!editing && (!state.key || state.key === normalizeDataStudioKey(state.name))) state.setKey(normalizeDataStudioKey(next));
            }} /></Field>
          <Field label="Table key" htmlFor={id + '-key'} hint={editing ? 'Table keys are fixed after creation.' : 'A stable name for APIs, functions and workflows.'}>
            <Input id={id + '-key'} value={state.key} disabled={controlsBlocked || editing} className="font-mono text-xs"
              onChange={event => state.setKey(normalizeDataStudioKey(event.target.value))} /></Field>
        </div>
        <Field label="Description (optional)" htmlFor={id + '-description'}><Textarea id={id + '-description'} value={state.description}
          disabled={controlsBlocked} rows={2} className="min-h-16 resize-none" placeholder="What does this table hold?"
          onChange={event => state.setDescription(event.target.value)} /></Field>
        {editing && props.table?.revision !== state.opening.table?.revision && <p role="status" className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">This table changed while you were editing. Your draft is preserved; saving checks the revision you opened.</p>}
        <DataStudioSchemaEditor draft={state.schema} disabled={controlsBlocked} jsonEditorRef={state.jsonEditorRef} maxColumns={props.maxColumns} />
      </form> }} />;
}
