'use client';

/**
 * data-studio-table-dialog.tsx
 *
 * Logical table metadata and ordered schema authoring control plane.
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH,
  DATA_STUDIO_COLUMN_TYPES,
  type DataStudioColumnType,
  type DataStudioSchema,
} from '../../data-studio/data-studio-contracts';
import type {
  DataStudioTable,
  DataStudioTableCreate,
} from '../../frontend/client/data-studio-client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Textarea } from '../ui/textarea';
import { DataStudioDefaultEditor } from './data-studio-default-editor';
import {
  DataStudioDialogField as Field,
  dataStudioDialogErrorMessage,
} from './data-studio-dialog-field';
import {
  buildDataStudioSchema,
  dataStudioColumnLabelPatch,
  dataStudioEditableColumns,
  initialDataStudioDefaultDraft,
  moveDataStudioEditableColumn,
  newDataStudioEditableColumn,
  normalizeDataStudioKey,
  type DataStudioDefaultMode,
  type DataStudioEditableColumn,
} from './data-studio-schema-draft';

export interface DataStudioTableDialogProps {
  readonly open: boolean;
  readonly table?: DataStudioTable | null;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate?: (input: DataStudioTableCreate) => Promise<unknown>;
  readonly onUpdate?: (input: {
    readonly name: string;
    readonly description: string | null;
    readonly schema: DataStudioSchema;
  }) => Promise<unknown>;
}

/** Create or revise a logical table without exposing physical SQL. */
export function DataStudioTableDialog({
  open,
  table,
  busy = false,
  onOpenChange,
  onCreate,
  onUpdate,
}: DataStudioTableDialogProps) {
  const initial = React.useMemo(() => tableDraft(table), [table]);
  const [name, setName] = React.useState(initial.name);
  const [key, setKey] = React.useState(initial.key);
  const [description, setDescription] = React.useState(initial.description);
  const [columns, setColumns] = React.useState<DataStudioEditableColumn[]>(initial.columns);
  const [error, setError] = React.useState<string | null>(null);
  const previousIdentity = React.useRef<string | null>(null);
  const identity = open ? table?.tableId ?? '__create' : null;
  React.useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    if (identity) {
      setName(initial.name);
      setKey(initial.key);
      setDescription(initial.description);
      setColumns(initial.columns);
      setError(null);
    }
  }, [identity, initial]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const schema = buildDataStudioSchema(columns);
      const cleanName = name.trim();
      if (!cleanName) throw new Error('Table name is required.');
      if (table) {
        if (!onUpdate) throw new Error('Table updates are unavailable.');
        await onUpdate({
          name: cleanName,
          description: description.trim() || null,
          schema,
        });
      } else {
        if (!onCreate) throw new Error('Table creation is unavailable.');
        const cleanKey = normalizeDataStudioKey(key || name);
        if (!cleanKey) throw new Error('A machine key is required.');
        await onCreate({
          name: cleanName,
          key: cleanKey,
          description: description.trim() || null,
          schema,
        });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(dataStudioDialogErrorMessage(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{table ? 'Edit table schema' : 'Create table'}</DialogTitle>
            <DialogDescription>
              Define stable fields for records in this organization. Schema changes are revision checked.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name" htmlFor="data-studio-table-name">
              <Input
                id="data-studio-table-name"
                value={name}
                disabled={busy}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  if (!table && (!key || key === normalizeDataStudioKey(name))) {
                    setKey(normalizeDataStudioKey(event.target.value));
                  }
                }}
              />
            </Field>
            <Field label="Machine key" htmlFor="data-studio-table-key" hint={table ? 'Immutable after creation' : 'Used by browser APIs and workflows'}>
              <Input
                id="data-studio-table-key"
                value={key}
                disabled={busy || Boolean(table)}
                className="font-mono"
                onChange={(event) => setKey(normalizeDataStudioKey(event.target.value))}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="data-studio-table-description">
            <Textarea
              id="data-studio-table-description"
              value={description}
              disabled={busy}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Columns</h3>
                <p className="text-xs text-muted-foreground">Order controls presentation. Existing keys change only when edited directly.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setColumns((current) => [
                  ...current,
                  newDataStudioEditableColumn(current.length),
                ])}
              >
                <Plus className="size-3.5" aria-hidden="true" /> Add column
              </Button>
            </div>
            <div className="space-y-2">
              {columns.map((column, index) => (
                <div key={column.columnId} className="space-y-2 rounded-lg border p-2">
                  <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.75fr_auto_auto] sm:items-end">
                    <Field label="Label" htmlFor={`column-label-${column.columnId}`}>
                      <Input
                        id={`column-label-${column.columnId}`}
                        value={column.label}
                        disabled={busy}
                        onChange={(event) => updateColumn(
                          setColumns,
                          index,
                          dataStudioColumnLabelPatch(column, event.target.value),
                        )}
                      />
                    </Field>
                    <Field
                      label="Key"
                      htmlFor={`column-key-${column.columnId}`}
                      hint={column.persisted ? 'API contract change when edited' : undefined}
                    >
                      <Input
                        id={`column-key-${column.columnId}`}
                        value={column.key}
                        disabled={busy}
                        className="font-mono"
                        onChange={(event) => updateColumn(setColumns, index, {
                          key: normalizeDataStudioKey(event.target.value),
                        })}
                      />
                    </Field>
                    <Field label="Type">
                      <Select
                        value={column.type}
                        disabled={busy}
                        onValueChange={(value) => {
                          const type = value as DataStudioColumnType;
                          updateColumn(setColumns, index, {
                            type,
                            defaultMode: 'none',
                            defaultDraft: initialDataStudioDefaultDraft(type),
                          });
                        }}
                      >
                        <SelectTrigger aria-label={`${column.label || `Column ${index + 1}`} type`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DATA_STUDIO_COLUMN_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <label className="flex h-9 items-center gap-2 whitespace-nowrap text-sm">
                      <Checkbox
                        checked={column.required}
                        disabled={busy}
                        onCheckedChange={(checked) => {
                          const required = checked === true;
                          updateColumn(setColumns, index, {
                            required,
                            ...(required && column.defaultMode === 'null'
                              ? { defaultMode: 'none' as const }
                              : {}),
                          });
                        }}
                      />
                      Required
                    </label>
                    <ColumnOrderControls
                      column={column}
                      index={index}
                      columnCount={columns.length}
                      busy={busy}
                      setColumns={setColumns}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1.2fr] sm:items-end">
                    <Field label="Description" htmlFor={`column-description-${column.columnId}`}>
                      <Input
                        id={`column-description-${column.columnId}`}
                        value={column.description}
                        maxLength={DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH}
                        disabled={busy}
                        placeholder="Optional field guidance"
                        onChange={(event) => updateColumn(setColumns, index, {
                          description: event.target.value,
                        })}
                      />
                    </Field>
                    <Field label="Default">
                      <div className="flex min-w-0 gap-2">
                        <Select
                          value={column.defaultMode}
                          disabled={busy}
                          onValueChange={(value) => updateColumn(setColumns, index, {
                            defaultMode: value as DataStudioDefaultMode,
                          })}
                        >
                          <SelectTrigger className="w-28 shrink-0" aria-label={`${column.label} default mode`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No default</SelectItem>
                            <SelectItem value="null" disabled={column.required}>Null</SelectItem>
                            <SelectItem value="value">Value</SelectItem>
                          </SelectContent>
                        </Select>
                        <DataStudioDefaultEditor
                          column={column}
                          disabled={busy}
                          onChange={(defaultDraft) => updateColumn(setColumns, index, {
                            defaultDraft,
                          })}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : table ? 'Save schema' : 'Create table'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColumnOrderControls({
  column,
  index,
  columnCount,
  busy,
  setColumns,
}: {
  column: DataStudioEditableColumn;
  index: number;
  columnCount: number;
  busy: boolean;
  setColumns: React.Dispatch<React.SetStateAction<DataStudioEditableColumn[]>>;
}) {
  const label = column.label || `column ${index + 1}`;
  return (
    <div className="flex h-9 items-center justify-end gap-0.5">
      <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy || index === 0} aria-label={`Move ${label} up`} onClick={() => setColumns((current) => moveDataStudioEditableColumn(current, index, -1))}>
        <ArrowUp className="size-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy || index === columnCount - 1} aria-label={`Move ${label} down`} onClick={() => setColumns((current) => moveDataStudioEditableColumn(current, index, 1))}>
        <ArrowDown className="size-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy} aria-label={`Remove ${label}`} onClick={() => setColumns((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function tableDraft(table?: DataStudioTable | null) {
  return {
    name: table?.name ?? '',
    key: table?.key ?? '',
    description: table?.description ?? '',
    columns: dataStudioEditableColumns(table),
  };
}

function updateColumn(
  setColumns: React.Dispatch<React.SetStateAction<DataStudioEditableColumn[]>>,
  index: number,
  patch: Partial<DataStudioEditableColumn>,
) {
  setColumns((current) => current.map((column, itemIndex) =>
    itemIndex === index ? { ...column, ...patch } : column));
}
