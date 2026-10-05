'use client';

/** Spacious table metadata/schema composition; session hook owns admission and persistence callbacks. */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { DataStudioDialogField as Field } from './data-studio-dialog-field';
import { normalizeDataStudioKey } from './data-studio-schema-draft';
import { DataStudioSchemaEditor } from './data-studio-schema-editor';
import { useDataStudioTableDialog } from './use-data-studio-table-dialog';
import type { DataStudioTableDialogProps } from './data-studio-table-dialog.types';
export type { DataStudioTableDialogProps } from './data-studio-table-dialog.types';

/** Create/edit sessions capture the table revision when opened, not after background refreshes. */
export function DataStudioTableDialog(props: DataStudioTableDialogProps) {
  const close = React.useRef<(() => void) | null>(null);
  return <Dialog open={props.open} onOpenChange={next => next ? props.onOpenChange(true) : close.current?.()}>
    {props.open && <TableDialogSession key={props.table?.tableId ?? '__create'} {...props} closeRef={close} />}
  </Dialog>;
}

function TableDialogSession({ closeRef, ...props }: DataStudioTableDialogProps & { closeRef: React.RefObject<(() => void) | null> }) {
  const state = useDataStudioTableDialog(props), editing = Boolean(state.opening.table);
  const id = React.useId();
  closeRef.current = state.requestClose;
  React.useEffect(() => {
    const request = state.requestClose;
    closeRef.current = request;
    return () => { if (closeRef.current === request) closeRef.current = null; };
  }, [closeRef, state.requestClose]);
  const controlsBlocked = state.blocked || state.accepted || state.impact.length > 0;
  return <DialogContent data-slot="data-studio-table-dialog"
    style={{ width: 'min(68rem, calc(100vw - 2rem))' }}
    className="flex max-h-[calc(100dvh-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
    <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-16">
      <DialogTitle>{editing ? 'Edit table' : 'Create table'}</DialogTitle>
      <DialogDescription>Define fields once, then use them from your functions, workflows and APIs.</DialogDescription>
    </DialogHeader>
    <form className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={event => { event.preventDefault(); void state.save(); }}>
      <div data-slot="data-studio-table-dialog-body" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Table name" htmlFor={id + '-name'}><Input id={id + '-name'} data-slot="data-studio-table-name"
            autoFocus value={state.name} disabled={controlsBlocked} placeholder="Contacts, tasks, customers…"
            onChange={event => {
              const next = event.target.value; state.setName(next);
              if (!editing && (!state.key || state.key === normalizeDataStudioKey(state.name))) state.setKey(normalizeDataStudioKey(next));
            }} /></Field>
          <Field label="Table key" htmlFor={id + '-key'} hint={editing ? 'Table keys are fixed after creation.' : 'A stable name for APIs, functions and workflows.'}>
            <Input id={id + '-key'} value={state.key} disabled={controlsBlocked || editing} className="font-mono text-xs"
              onChange={event => state.setKey(normalizeDataStudioKey(event.target.value))} /></Field>
        </div>
        <Field label="Description (optional)" htmlFor={id + '-description'}><Textarea
          id={id + '-description'} value={state.description} disabled={controlsBlocked} rows={2}
          className="min-h-16 resize-none" placeholder="What does this table hold?"
          onChange={event => state.setDescription(event.target.value)} /></Field>
        {editing && props.table?.revision !== state.opening.table?.revision && <p role="status" className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">This table changed while you were editing. Your draft is preserved; saving checks the revision you opened.</p>}
        <DataStudioSchemaEditor draft={state.schema} disabled={controlsBlocked} jsonEditorRef={state.jsonEditorRef} maxColumns={props.maxColumns} />
      </div>
      <div className="shrink-0 border-t border-border bg-muted/10 px-5 py-4 sm:px-6">
        {state.error && <p role="alert" className="mb-3 text-sm text-destructive">{state.error}</p>}
        {state.accepted && <p role="status" className="mb-3 text-sm text-muted-foreground">Changes saved successfully.</p>}
        {state.impact.length > 0 ? <div role="alert" className="space-y-3">
          <div><h4 className="text-sm font-semibold">Review schema changes</h4><p className="mt-1 text-xs text-muted-foreground">Existing data and caller compatibility are checked again on the server. This does not migrate or delete stored values.</p></div>
          <ul className="max-h-24 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">{state.impact.map(item => <li key={item}>{item}</li>)}</ul>
          <DialogFooter><Button type="button" variant="outline" disabled={state.blocked} onClick={() => state.setImpact([])}>Keep editing</Button>
            <Button type="button" disabled={state.blocked} onClick={() => { void state.save(true); }}>Confirm and save</Button></DialogFooter>
        </div> : state.confirmClose ? <div role="alert" className="space-y-3">
          <div><h4 className="text-sm font-semibold">Save your changes?</h4><p className="mt-1 text-xs text-muted-foreground">Your draft will be discarded if you leave without saving.</p></div>
          <DialogFooter><Button type="button" variant="ghost" disabled={state.blocked} onClick={() => state.setConfirmClose(false)}>Keep editing</Button>
            <Button type="button" variant="outline" disabled={state.blocked} onClick={state.discard}>Discard changes</Button>
            <Button type="button" disabled={state.blocked} onClick={() => { void state.save(); }}>{state.pending ? 'Saving…' : 'Save changes'}</Button></DialogFooter>
        </div> : <DialogFooter><Button type="button" variant="outline" disabled={state.blocked} onClick={state.requestClose}>Cancel</Button>
          <Button type="submit" disabled={state.blocked || state.accepted}>{state.pending ? 'Saving…' : state.accepted ? 'Saved' : editing ? 'Save changes' : 'Create table'}</Button></DialogFooter>}
      </div>
    </form>
  </DialogContent>;
}
