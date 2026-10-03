'use client';

/**
 * data-studio-row-dialog.tsx
 *
 * Schema-driven create-record form for the active logical Data Studio table.
 */

import * as React from 'react';
import type { DataStudioTable } from '../../frontend/client/data-studio-client';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import {
  DataStudioDialogField as Field,
  dataStudioDialogErrorMessage,
} from './data-studio-dialog-field';
import { dataStudioValueDraft, parseDataStudioValueDraft } from './data-studio-value';

export interface DataStudioRowDialogProps {
  readonly open: boolean;
  readonly table: DataStudioTable | null;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (values: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

/** Generate a typed create-record form from the active logical schema. */
export function DataStudioRowDialog({
  open,
  table,
  busy = false,
  onOpenChange,
  onCreate,
}: DataStudioRowDialogProps) {
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [booleans, setBooleans] = React.useState<Record<string, boolean | null>>({});
  const [touched, setTouched] = React.useState<Record<string, true>>({});
  const [error, setError] = React.useState<string | null>(null);
  const previousOpen = React.useRef(false);
  const previousTableId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (open && (!previousOpen.current || previousTableId.current !== table?.tableId)) {
      setDrafts(rowDefaultDrafts(table));
      setBooleans(rowDefaultBooleans(table));
      setTouched({});
      setError(null);
    }
    previousOpen.current = open;
    previousTableId.current = table?.tableId ?? null;
  }, [open, table]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!table) return;
    try {
      const values: Record<string, unknown> = {};
      for (const column of table.schema.columns) {
        if (!touched[column.columnId]) {
          if (column.required && !Object.hasOwn(column, 'defaultValue')) {
            throw new Error(`${column.label} is required.`);
          }
          continue;
        }
        if (column.type === 'boolean') {
          const value = booleans[column.columnId];
          values[column.key] = value === undefined ? false : value;
          continue;
        }
        const draft = drafts[column.columnId] ?? '';
        values[column.key] = parseDataStudioValueDraft(draft, column);
      }
      await onCreate(values);
      onOpenChange(false);
    } catch (cause) {
      setError(dataStudioDialogErrorMessage(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New {table?.name ?? 'record'}</DialogTitle>
            <DialogDescription>Create one record using the current schema.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {table?.schema.columns.map((column) => (
              <Field
                key={column.columnId}
                label={`${column.label}${column.required ? ' *' : ''}`}
                htmlFor={`new-row-${column.columnId}`}
                hint={column.description}
              >
                {column.type === 'boolean' ? (
                  <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                    <Checkbox
                      id={`new-row-${column.columnId}`}
                      checked={booleans[column.columnId] === null
                        ? 'indeterminate'
                        : booleans[column.columnId] ?? false}
                      disabled={busy}
                      onCheckedChange={(checked) => {
                        setBooleans((current) => ({
                          ...current,
                          [column.columnId]: checked === 'indeterminate' ? null : checked === true,
                        }));
                        setTouched((current) => ({
                          ...current,
                          [column.columnId]: true,
                        }));
                      }}
                    />
                    {booleans[column.columnId] === null
                      ? Object.hasOwn(column, 'defaultValue') ? 'Null (default)' : 'Empty'
                      : booleans[column.columnId] ? 'True' : 'False'}
                  </label>
                ) : column.type === 'json' ? (
                  <Textarea
                    id={`new-row-${column.columnId}`}
                    value={drafts[column.columnId] ?? ''}
                    disabled={busy}
                    className="font-mono text-xs"
                    placeholder={column.required ? '{ }' : 'null'}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [column.columnId]: event.target.value,
                    }))}
                    onInput={() => setTouched((current) => ({
                      ...current,
                      [column.columnId]: true,
                    }))}
                  />
                ) : (
                  <Input
                    id={`new-row-${column.columnId}`}
                    type={column.type === 'number'
                      ? 'number'
                      : column.type === 'date'
                        ? 'date'
                        : column.type === 'datetime'
                          ? 'datetime-local'
                          : 'text'}
                    step={column.type === 'number'
                      ? 'any'
                      : column.type === 'datetime'
                        ? '0.001'
                        : undefined}
                    value={drafts[column.columnId] ?? ''}
                    disabled={busy}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [column.columnId]: event.target.value,
                    }))}
                    onInput={() => setTouched((current) => ({
                      ...current,
                      [column.columnId]: true,
                    }))}
                  />
                )}
              </Field>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !table}>Create record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function rowDefaultDrafts(table: DataStudioTable | null): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const column of table?.schema.columns ?? []) {
    if (column.type !== 'boolean' && Object.hasOwn(column, 'defaultValue')) {
      drafts[column.columnId] = dataStudioValueDraft(column.defaultValue, column);
    }
  }
  return drafts;
}

function rowDefaultBooleans(table: DataStudioTable | null): Record<string, boolean | null> {
  const booleans: Record<string, boolean | null> = {};
  for (const column of table?.schema.columns ?? []) {
    if (column.type !== 'boolean') continue;
    if (typeof column.defaultValue === 'boolean' || column.defaultValue === null) {
      booleans[column.columnId] = column.defaultValue;
    } else {
      booleans[column.columnId] = null;
    }
  }
  return booleans;
}
