'use client';

/**
 * data-studio-row-dialog.tsx
 *
 * Composes a roomy, bounded create-record form from Zero's existing dialog and
 * field controls. Draft validation and acknowledged-write lifecycles live in
 * focused modules; this view never fetches, provisions storage or grants access.
 */
import * as React from 'react';
import { Database, LoaderCircle, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { DataStudioRowField } from './data-studio-row-field';
import { useDataStudioRowDialog } from './use-data-studio-row-dialog';
import type { DataStudioRowDialogProps } from './data-studio-row-dialog.types';
export type { DataStudioRowDialogProps } from './data-studio-row-dialog.types';

/** Open one stable table/scope session; retired requests cannot affect another form. */
export function DataStudioRowDialog(props: DataStudioRowDialogProps) {
  const close = React.useRef<(() => void) | null>(null);
  const key = JSON.stringify([typeof props.scopeKey, props.scopeKey, props.table?.tableId, props.open]);
  const lifetime = React.useRef({ key, epoch: {} });
  if (lifetime.current.key !== key) lifetime.current = { key, epoch: {} };
  const owner = lifetime.current.epoch;
  return <Dialog open={props.open} onOpenChange={next => next ? props.onOpenChange(true) : close.current?.()}>
    {props.open && props.table && <RowDialogSession key={key} {...props} closeRef={close}
      isOwnerCurrent={() => lifetime.current.epoch === owner} />}
  </Dialog>;
}

function RowDialogSession({ closeRef, ...props }: DataStudioRowDialogProps & {
  closeRef: React.RefObject<(() => void) | null>; isOwnerCurrent(): boolean;
}) {
  const state = useDataStudioRowDialog(props), id = React.useId();
  closeRef.current = state.requestClose;
  React.useEffect(() => {
    const request = state.requestClose; closeRef.current = request;
    return () => { if (closeRef.current === request) closeRef.current = null; };
  }, [closeRef, state.requestClose]);
  const columns = state.opening.schema.columns;
  const required = columns.filter(column => column.required && !Object.hasOwn(column, 'defaultValue')).length;
  return <DialogContent data-slot="data-studio-row-dialog" showCloseButton={!state.pending && !props.busy}
    style={{ width: 'min(52rem, calc(100vw - 2rem))' }}
    className="flex max-h-[calc(100dvh-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
    onOpenAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => state.focusField()); }}>
    <DialogHeader className="shrink-0 border-b border-border/85 bg-muted/15 px-5 py-5 pr-16 text-left sm:px-6 sm:pr-16">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary"><Database className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 space-y-1.5"><DialogTitle className="break-words leading-snug">Add record to {props.table?.name}</DialogTitle>
          <DialogDescription>Add the values below. Fields marked * need a value.</DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-0.5"><Badge variant="outline" className="text-[11px] font-normal">{columns.length} fields</Badge>
            {required > 0 && <span className="text-xs text-muted-foreground">{required} required without a default</span>}
          </div>
        </div>
      </div>
    </DialogHeader>
    <form ref={state.formRef} noValidate className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onSubmit={event => { event.preventDefault(); void state.save(); }}>
      <div data-slot="data-studio-row-dialog-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        {state.schemaChanged && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="min-w-0"><p className="text-sm font-medium">The table fields changed</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Your values are kept. Reload the fields before creating this record.</p></div>
          <Button type="button" variant="outline" size="sm" disabled={state.pending || props.busy || state.uncertain} onClick={state.requestReload}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Reload fields
          </Button>
        </div>}
        {state.archived && <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">This table is archived. Restore it before adding records.</p>}
        <div data-slot="data-studio-row-dialog-fields" className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
          {columns.map(column => <DataStudioRowField key={column.columnId} column={column} draft={state.draft[column.columnId]}
            id={id + '-' + column.columnId} disabled={state.fieldsBlocked || state.confirmation !== null}
            error={state.fieldErrors[column.columnId]} onChange={raw => state.changeField(column.columnId, raw)} />)}
        </div>
      </div>
      <div data-slot="data-studio-row-dialog-footer" className="shrink-0 border-t border-border/85 bg-muted/10 px-5 py-4 sm:px-6">
        {state.error && <p role="alert" className="mb-3 text-sm leading-relaxed text-destructive">{state.error}</p>}
        {state.accepted && <p role="status" className="mb-3 text-sm text-muted-foreground">Record created successfully.</p>}
        {state.confirmation ? <div className="space-y-3" role="alert">
          <div><h4 className="text-sm font-semibold">{state.confirmation === 'reload' ? 'Reload the fields?' : state.uncertain ? 'Close without confirming the result?' : 'Discard this record draft?'}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.confirmation === 'reload'
              ? 'The values in this form will be cleared so you can use the updated fields.'
              : state.uncertain ? 'The request may have created a record. Check the table before adding it again.' : 'Your entered values will be lost. No record has been created.'}</p>
          </div>
          <DialogFooter><Button type="button" variant="ghost" disabled={state.pending || props.busy} onClick={state.keepEditing}>Keep editing</Button>
            <Button type="button" variant="outline" disabled={state.pending || props.busy} onClick={state.discard}>{state.confirmation === 'reload' ? 'Discard and reload' : state.uncertain ? 'Close form' : 'Discard draft'}</Button>
            {state.confirmation === 'discard' && !state.uncertain && <Button type="submit" disabled={state.blocked}>Create record</Button>}
          </DialogFooter>
        </div> : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-muted-foreground">{state.pending ? 'Creating your record…' : state.uncertain ? 'The exact request is kept for a safe retry.'
            : columns.some(column => Object.hasOwn(column, 'defaultValue')) ? 'Unchanged defaults are applied automatically.' : 'Values are saved only when you create the record.'}</p>
          <DialogFooter className="shrink-0"><Button type="button" variant="outline" disabled={state.pending || props.busy} onClick={state.requestClose}>{state.accepted ? 'Close' : 'Cancel'}</Button>
            <Button type="submit" disabled={state.blocked} aria-busy={state.pending || undefined}>{state.pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {state.pending ? 'Creating…' : state.accepted ? 'Created' : state.uncertain ? 'Retry request' : 'Create record'}</Button>
          </DialogFooter>
        </div>}
      </div>
    </form>
  </DialogContent>;
}
