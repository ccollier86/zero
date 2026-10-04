'use client';

import * as React from 'react';
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import type { FieldMeta } from '../../schema/field-types';
import { Input } from '#zero/components/ui/input';
import { Button } from '#zero/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { DatePicker } from '#zero/components/ui/date-picker';
import { DateRangePicker } from '#zero/components/ui/date-range-picker';
import { TagInput } from '#zero/components/ui/tag-input';
import { Combobox } from '#zero/components/ui/combobox';

export interface EditableCellEditorProps {
  value: unknown;
  fieldMeta?: FieldMeta;
  pending: boolean;
  error: string | null;
  onCommit(value: unknown, advanceAfterSave?: boolean): Promise<boolean>;
  onCancel(): void;
  onRetry(): Promise<boolean>;
  onDraftChange(): void;
}

export function EditableCellEditor({
  value,
  fieldMeta,
  pending,
  error,
  onCommit,
  onCancel,
  onRetry,
  onDraftChange,
}: EditableCellEditorProps) {
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const type = fieldMeta?.type ?? 'text';

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = React.useCallback(async (
    next = draft,
    advanceAfterSave = false,
  ) => {
    const accepted = await onCommit(next, advanceAfterSave);
    if (!accepted) requestAnimationFrame(() => inputRef.current?.focus());
  }, [draft, onCommit]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!pending) onCancel();
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    if (!pending) void commit(draft, event.key === 'Tab');
  }, [commit, draft, onCancel, pending]);

  const changeDraft = React.useCallback((next: unknown) => {
    setDraft(next);
    onDraftChange();
  }, [onDraftChange]);

  return (
    <div
      data-slot="editable-cell-editor"
      data-save-state={pending ? 'pending' : error ? 'error' : 'idle'}
      className="min-w-0 space-y-1"
      aria-busy={pending || undefined}
    >
      <EditorControl
        type={type}
        draft={draft}
        fieldMeta={fieldMeta}
        pending={pending}
        inputRef={inputRef}
        setDraft={changeDraft}
        commit={commit}
        onKeyDown={handleKeyDown}
      />
      {pending && (
        <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> Saving…
        </span>
      )}
      {error && !pending && (
        <span role="alert" className="flex min-w-0 items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto h-5 px-1.5 text-destructive hover:text-destructive"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { void onRetry(); }}
          >
            <RotateCcw className="size-3" /> Retry
          </Button>
        </span>
      )}
    </div>
  );
}

interface EditorControlProps {
  type: FieldMeta['type'];
  draft: unknown;
  fieldMeta?: FieldMeta;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setDraft(value: unknown): void;
  commit(value?: unknown, advanceAfterSave?: boolean): Promise<void>;
  onKeyDown(event: React.KeyboardEvent): void;
}

function EditorControl({
  type,
  draft,
  fieldMeta,
  pending,
  inputRef,
  setDraft,
  commit,
  onKeyDown,
}: EditorControlProps) {
  if ((type === 'select' || type === 'enum') && fieldMeta?.options) {
    return (
      <Select
        value={(draft as string) ?? ''}
        disabled={pending}
        onValueChange={(next) => { setDraft(next); void commit(next); }}
      >
        <SelectTrigger className="h-7 text-xs" autoFocus aria-invalid={undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fieldMeta.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === 'date' || type === 'datetime') {
    return (
      <DatePicker
        value={draft ? new Date(draft as string) : undefined}
        disabled={pending}
        onChange={(date) => {
          const next = date
            ? type === 'datetime' ? date.toISOString() : date.toISOString().split('T')[0]
            : '';
          setDraft(next);
          void commit(next);
        }}
      />
    );
  }

  if (type === 'dateRange') {
    const values = Array.isArray(draft) ? draft as string[] : ['', ''];
    const range: DateRange | undefined = values[0] && values[1]
      ? { from: new Date(values[0]), to: new Date(values[1]) }
      : undefined;
    return (
      <DateRangePicker
        value={range}
        disabled={pending}
        onChange={(nextRange) => {
          if (nextRange?.from && nextRange.to) {
            const next = [
              nextRange.from.toISOString().split('T')[0],
              nextRange.to.toISOString().split('T')[0],
            ];
            setDraft(next);
            void commit(next);
          } else if (!nextRange?.from && !nextRange?.to) {
            const next = ['', ''];
            setDraft(next);
            void commit(next);
          }
        }}
      />
    );
  }

  if (type === 'tags') {
    return (
      <div
        onKeyDown={(event) => { if (!event.defaultPrevented) onKeyDown(event); }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && !pending) void commit();
        }}
      >
        <TagInput
          value={Array.isArray(draft) ? draft as string[] : []}
          disabled={pending}
          onChange={setDraft as (tags: string[]) => void}
          placeholder="Add tag..."
        />
      </div>
    );
  }

  if (type === 'combobox' && fieldMeta?.options) {
    return (
      <Combobox
        value={draft as string | string[]}
        disabled={pending}
        onChange={(next) => { setDraft(next); void commit(next); }}
        options={fieldMeta.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        multiple={fieldMeta.multiple}
        searchable={fieldMeta.searchable ?? true}
      />
    );
  }

  return (
    <Input
      ref={inputRef}
      type={type === 'number' ? 'number' : type === 'email' ? 'email' : type === 'url' ? 'url' : 'text'}
      value={draft == null ? '' : String(draft)}
      disabled={pending}
      onChange={(event) => {
        const next = type === 'number'
          ? event.target.value === '' ? '' : Number(event.target.value)
          : event.target.value;
        setDraft(next);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => { if (!pending) void commit(); }}
      className="h-7 text-xs"
      min={fieldMeta?.min}
      max={fieldMeta?.max}
    />
  );
}
