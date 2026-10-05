'use client';

/** Reusable column settings over a caller-owned draft; local validation precedes optional acceptance. */
import * as React from 'react';
import type { DataStudioColumn } from '../../data-studio/data-studio-contracts';
import { DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH } from '../../data-studio/data-studio-contracts';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DataStudioDefaultEditor } from './data-studio-default-editor';
import {
  buildDataStudioSchema, dataStudioColumnLabelPatch, normalizeDataStudioKey,
  type DataStudioEditableColumn,
} from './data-studio-schema-draft';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

export const DATA_STUDIO_TYPE_LABELS = {
  text: 'Text', number: 'Number', boolean: 'True / false', date: 'Date',
  datetime: 'Date & time', json: 'JSON',
} as const;

export interface DataStudioColumnEditorProps {
  readonly column: DataStudioEditableColumn;
  readonly onChange: (next: DataStudioEditableColumn) => void;
  readonly onApply?: (column: DataStudioColumn) => void | Promise<unknown>;
  readonly onCancel?: () => void;
  readonly disabled?: boolean;
  readonly keyEditable?: boolean;
  readonly autoFocus?: boolean;
  readonly applyLabel?: string;
  readonly className?: string;
}

export function DataStudioColumnEditor({
  column, onChange, onApply, onCancel, disabled = false, keyEditable = true,
  autoFocus = true, applyLabel = 'Apply changes', className,
}: DataStudioColumnEditorProps) {
  const id = React.useId();
  const labelRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = React.useState<string | null>(null);
  const originalKey = React.useRef(column.key);
  const generation = React.useRef(0);
  const inFlight = React.useRef(false), mounted = React.useRef(true);
  const activeId = React.useRef(column.columnId);
  if (activeId.current !== column.columnId) {
    activeId.current = column.columnId; originalKey.current = column.key; inFlight.current = false; generation.current++;
  }
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    setError(null); setPending(false); setAcknowledgedKey(null);
    if (autoFocus) { labelRef.current?.focus(); labelRef.current?.select(); }
  }, [autoFocus, column.columnId]);
  const patch = (next: Partial<DataStudioEditableColumn>) => { setError(null); onChange({ ...column, ...next }); };
  const blocked = disabled || pending;
  const apply = async () => {
    if (blocked || inFlight.current || !mounted.current || !onApply) return;
    if (column.persisted && column.key !== originalKey.current && acknowledgedKey !== column.key) {
      setError('Confirm the field key change before applying it.'); return;
    }
    let normalized: DataStudioColumn;
    try { normalized = buildDataStudioSchema([column]).columns[0]!; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the field settings.'); return; }
    inFlight.current = true; setPending(true);
    const identity = column.columnId;
    const admittedGeneration = generation.current;
    try { await onApply(normalized); }
    catch (cause) {
      if (mounted.current && activeId.current === identity && generation.current === admittedGeneration) {
        setError(cause instanceof Error ? cause.message : 'The field could not be saved.');
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, {
          metadata: { surface: 'column-editor', stage: 'apply' },
        });
      }
    } finally {
      if (activeId.current === identity && generation.current === admittedGeneration) inFlight.current = false;
      if (mounted.current && activeId.current === identity && generation.current === admittedGeneration) setPending(false);
    }
  };

  return (
    <div data-slot="data-studio-column-editor" className={className}>
      <div className="space-y-5">
        <div>
          <Label htmlFor={id + '-label'} className="mb-1.5 text-xs text-muted-foreground">Column name</Label>
          <Input ref={labelRef} id={id + '-label'} data-slot="data-studio-column-label"
            aria-label="Column name" value={column.label} disabled={blocked}
            className="h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold text-foreground outline-none transition-colors hover:border-border focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
            onChange={event => patch(dataStudioColumnLabelPatch(column, event.target.value))} />
        </div>
        <div>
          <Label htmlFor={id + '-key'} className="mb-1.5 text-xs text-muted-foreground">Field key</Label>
          <Input id={id + '-key'} aria-label="Column field key" value={column.key}
            disabled={blocked || !keyEditable}
            className="h-8 w-full min-w-0 rounded-md border border-transparent bg-muted/25 px-2 font-mono text-xs text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
            onChange={event => patch({ key: normalizeDataStudioKey(event.target.value) })} />
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            {column.persisted ? 'Existing field keys do not follow name changes.' : 'Used by your functions, workflows and API calls.'}
          </p>
          {column.persisted && column.key !== originalKey.current && <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3">
            <p className="text-xs leading-5 text-muted-foreground">Renaming <code>{originalKey.current}</code> changes how functions and workflows address this field. Stored values keep their stable column ID.</p>
            {onApply && <label className="mt-2 flex items-start gap-2 text-xs"><Checkbox
              aria-label="Confirm column field key rename" checked={acknowledgedKey === column.key} disabled={blocked}
              onCheckedChange={checked => setAcknowledgedKey(checked === true ? column.key : null)} />I understand that callers using the old field key must be updated.</label>}
          </div>}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">Value type</Label>
            <Select value={column.type} disabled={blocked} onValueChange={type => patch({ type: type as DataStudioEditableColumn['type'] })}>
              <SelectTrigger aria-label="Column value type"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DATA_STUDIO_TYPE_LABELS).map(([type, label]) => <SelectItem key={type} value={type}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex h-9 items-center gap-2 text-sm"><Checkbox disabled={blocked}
            checked={column.required} aria-label="Column required"
            onCheckedChange={checked => patch({
              required: checked === true,
              ...(checked === true && column.defaultMode === 'null' ? { defaultMode: 'none' as const } : {}),
            })} />Required</label>
        </div>
        <div>
          <Label htmlFor={id + '-description'} className="mb-1.5 text-xs text-muted-foreground">Description <span className="font-normal">(optional)</span></Label>
          <Textarea id={id + '-description'} value={column.description} disabled={blocked}
            maxLength={DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH} rows={2}
            className="min-h-16 resize-none bg-transparent text-xs"
            placeholder="Help teammates understand this field."
            onChange={event => patch({ description: event.target.value })} />
        </div>
        <div>
          <Label className="mb-1.5 text-xs text-muted-foreground">Default value</Label>
          <div className="mb-2">
            <Select value={column.defaultMode} disabled={blocked}
              onValueChange={defaultMode => patch({ defaultMode: defaultMode as DataStudioEditableColumn['defaultMode'] })}>
              <SelectTrigger aria-label="Default value mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default</SelectItem>
                <SelectItem value="null" disabled={column.required}>Empty (null)</SelectItem>
                <SelectItem value="value">Custom value</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DataStudioDefaultEditor column={column} disabled={blocked} onChange={defaultDraft => patch({ defaultDraft })} />
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">A default applies when a new record omits this field.</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
      {(onApply || onCancel) && <div className="mt-5 flex justify-end gap-2 border-t border-border pt-3">
        {onCancel && <Button type="button" variant="ghost" size="sm" disabled={blocked} onClick={onCancel}>Cancel</Button>}
        {onApply && <Button type="button" size="sm" disabled={blocked} onClick={() => { void apply(); }}>{pending ? 'Saving…' : applyLabel}</Button>}
      </div>}
    </div>
  );
}
