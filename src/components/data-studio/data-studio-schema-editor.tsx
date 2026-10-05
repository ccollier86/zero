'use client';

/** Visual/code schema composition over one draft; selection and menus never persist data. */
import { useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Braces, Columns3, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { DataStudioColumnEditor, DATA_STUDIO_TYPE_LABELS } from './data-studio-column-editor';
import { JsonEditor, type JsonEditorHandle } from '../json-editor';
import { InlineEditText } from '../ui/inline-edit-text';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../animate-ui/components/radix/tabs';
import { normalizeDataStudioSchema } from '../../data-studio/data-studio-codec';
import { moveDataStudioEditableColumn, dataStudioColumnLabelPatch } from './data-studio-schema-draft';
import type { useDataStudioSchemaDraft } from './use-data-studio-schema-draft';
import { nextDataStudioDraftColumn, dataStudioUiColumnLimit } from './data-studio-table-draft';

export interface DataStudioSchemaEditorProps {
  readonly draft: ReturnType<typeof useDataStudioSchemaDraft>;
  readonly disabled?: boolean;
  readonly jsonEditorRef: RefObject<JsonEditorHandle<unknown> | null>;
  readonly maxColumns?: number;
}

export function DataStudioSchemaEditor({ draft, disabled = false, jsonEditorRef, maxColumns }: DataStudioSchemaEditorProps) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const limit = dataStudioUiColumnLimit(maxColumns);
  let columnCount: number | string = draft.columns.length;
  if (draft.mode === 'json') {
    try {
      const document: unknown = JSON.parse(draft.code);
      columnCount = document && typeof document === 'object' && 'columns' in document && Array.isArray(document.columns)
        ? document.columns.length : 'Draft';
    } catch { columnCount = 'Draft'; }
  }
  const selected = draft.columns.find(column => column.columnId === draft.selectedId);
  const remove = draft.columns.find(column => column.columnId === removeId);
  const addColumn = () => {
    if (disabled || draft.columns.length >= limit) return;
    const column = nextDataStudioDraftColumn(draft.columns);
    draft.setColumns(current => [...current, column]);
    draft.selectColumn(column.columnId);
  };

  return <Tabs value={draft.mode} onValueChange={mode => {
    if (mode === 'visual' && draft.mode === 'json') {
      const result = jsonEditorRef.current?.commit();
      if (!result?.ok) return;
      draft.changeMode('visual', result.value);
    } else draft.changeMode('json');
  }} className="gap-0 overflow-hidden rounded-xl border border-border bg-background" aria-label="Table schema">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
      <div><h3 className="text-sm font-semibold">Columns <span className="ml-1 text-xs font-normal text-muted-foreground">{columnCount} / {limit}</span></h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Build visually or edit the same schema as JSON.</p></div>
      <TabsList aria-label="Schema editor mode" className="h-8">
        {(['visual', 'json'] as const).map(mode => <TabsTrigger key={mode} value={mode} disabled={disabled}
          className="gap-1.5 px-2.5 text-xs">
          {mode === 'visual' ? <Columns3 className="size-3.5" /> : <Braces className="size-3.5" />}
          {mode === 'visual' ? 'Visual' : 'JSON'}
        </TabsTrigger>)}
      </TabsList>
    </div>
    {draft.error && <div role="alert" className="border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
      <span className="font-mono">{draft.error.path}</span>: {draft.error.message}
    </div>}
    <TabsContent value="json" className="p-4">
      <p className="mb-3 text-xs text-muted-foreground">Edit the actual DataStudioSchema object. IDs identify stored values; changing a name does not change its field key.</p>
      <JsonEditor value={draft.jsonValue} onChange={draft.changeJson} validate={value => {
        const normalized = normalizeDataStudioSchema(value);
        if (normalized.columns.length > limit) throw new Error(`This application allows at most ${limit} columns per table.`);
        return normalized;
      }} scrollMode="parent"
        label="Schema JSON" editorRef={jsonEditorRef} disabled={disabled}
        rawTextDraft={draft.rawTextDraft} onRawTextDraftChange={text => text === null ? draft.restoreJsonText() : draft.changeCode(text)}
        onEditingChange={draft.setJsonEditing} />
    </TabsContent>
    <TabsContent value="visual" className="grid min-h-[26rem] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
      <div className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Field order</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs"
            disabled={disabled || draft.columns.length >= limit} onClick={addColumn}><Plus className="size-3.5" />Add column</Button>
        </div>
        <div className="max-h-[28rem] space-y-1 overflow-y-auto px-2 pb-3" role="list" aria-label="Schema columns">
          {draft.columns.map((column, index) => <div key={column.columnId} role="listitem"
            className={cn('group flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:bg-muted/40',
              column.columnId === draft.selectedId && 'border-primary/15 bg-primary/5')}>
            <Button type="button" size="icon-xs" variant="secondary" disabled={disabled} aria-label={'Configure ' + (column.label || 'column ' + (index + 1))}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => draft.selectColumn(column.columnId)}>{column.type === 'json' ? '{}' : column.type === 'number' ? '#' : column.type === 'boolean' ? '✓' : column.type === 'date' || column.type === 'datetime' ? 'D' : 'T'}</Button>
            <div className="min-w-0 flex-1">
              <InlineEditText value={column.label} revision={column.columnId} label={'Column ' + (index + 1) + ' name'}
                disabled={disabled} selected={draft.selectedId === column.columnId} normalize={value => value}
                onSelect={() => draft.selectColumn(column.columnId)}
                onCommit={label => draft.setColumns(current => current.map(item => item.columnId === column.columnId
                  ? { ...item, ...dataStudioColumnLabelPatch(item, label) } : item))} />
              <p className="truncate px-1 font-mono text-[10px] text-muted-foreground">{column.key || 'Add a field key'}</p>
            </div>
            <div className="hidden min-w-0 shrink-0 text-right sm:block">
              <p className="text-[11px] text-muted-foreground">{DATA_STUDIO_TYPE_LABELS[column.type]}</p>
              {column.required && <Badge variant="secondary" className="mt-0.5 px-1 py-0 text-[9px] font-normal">Required</Badge>}
            </div>
            <div className="flex shrink-0 items-center">
              <Button type="button" size="icon-xs" variant="ghost" disabled={disabled || index === 0}
                aria-label={'Move ' + column.label + ' up'} onClick={() => draft.setColumns(current => moveDataStudioEditableColumn(current, index, -1))}><ArrowUp className="size-3" /></Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={disabled || index === draft.columns.length - 1}
                aria-label={'Move ' + column.label + ' down'} onClick={() => draft.setColumns(current => moveDataStudioEditableColumn(current, index, 1))}><ArrowDown className="size-3" /></Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={disabled}
                aria-label={'Remove ' + column.label} className="text-muted-foreground hover:text-destructive"
                onClick={() => setRemoveId(column.columnId)}><Trash2 className="size-3" /></Button>
            </div>
          </div>)}
          {draft.columns.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">No columns yet.<br /><span className="text-xs">Add a field to start defining records.</span></div>}
        </div>
      </div>
      <div className="min-w-0 p-4 lg:p-5">
        {remove ? <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <h4 className="text-sm font-semibold">Remove {remove.label || 'this column'}?</h4>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">This changes the draft schema. Saved columns with existing values cannot be removed without an explicit data migration.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRemoveId(null)}>Keep column</Button>
            <Button type="button" size="sm" variant="destructive" disabled={disabled} onClick={() => {
              const next = draft.columns.filter(column => column.columnId !== remove.columnId);
              draft.setColumns(next);
              if (draft.selectedId === remove.columnId) draft.selectColumn(next[0]?.columnId ?? null);
              setRemoveId(null);
            }}>Remove column</Button>
          </div>
        </div> : selected ? <DataStudioColumnEditor column={selected} disabled={disabled} autoFocus={false}
          onChange={next => draft.setColumns(current => current.map(column => column.columnId === next.columnId ? next : column))} />
          : <p className="py-12 text-center text-sm text-muted-foreground">Select a column to configure its values.</p>}
      </div>
    </TabsContent>
  </Tabs>;
}
