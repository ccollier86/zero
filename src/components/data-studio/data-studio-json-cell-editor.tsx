'use client';

/** Structured JSON cell drafts compose the existing Zero JsonEditor, never a transport. */
import * as React from 'react';
import type { DataStudioColumn, DataStudioValue } from '../../frontend/client/data-studio-client';
import { normalizeDataStudioValueForColumn } from '../../data-studio/data-studio-codec';
import { JsonEditor, type JsonEditorHandle } from '../json-editor';
import { DataStudioCellEditor } from './data-studio-cell-editor';

export function DataStudioJsonCellEditor({
  children, open, column, value, disabled, pending, dirty, error,
  onOpenChange, onValueChange, onApply, onCancel,
}: {
  readonly children: React.ReactElement;
  readonly open: boolean;
  readonly column: DataStudioColumn;
  readonly value: string;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly onApply: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const apply = React.useRef<(() => void) | null>(null);
  return <DataStudioCellEditor open={open} label={column.label}
    description="Edit the structured value or JSON text. Apply saves the complete value."
    className="w-[min(34rem,calc(100vw-1.5rem))]"
    disabled={disabled} pending={pending} dirty={dirty} error={error}
    onOpenChange={onOpenChange} onApply={() => apply.current?.()} onCancel={onCancel}
    content={open && <JsonDraft column={column} initialValue={value} disabled={disabled || pending}
      onValueChange={onValueChange} onApply={onApply} apply={apply} />}>
    {children}
  </DataStudioCellEditor>;
}

/** One edit lifetime: keep the admitted document separate from unfinished invalid text. */
function JsonDraft({ column, initialValue, disabled, onValueChange, onApply, apply }: {
  readonly column: DataStudioColumn;
  readonly initialValue: string;
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onApply: (value: string) => void;
  readonly apply: React.RefObject<(() => void) | null>;
}) {
  const initial = React.useRef(parseInitial(initialValue));
  const [document, setDocument] = React.useState<DataStudioValue>(initial.current.value);
  const [raw, setRaw] = React.useState<string | null>(initial.current.raw);
  const editor = React.useRef<JsonEditorHandle<DataStudioValue>>(null);
  const admittedText = React.useRef(initialValue);
  const currentText = React.useRef(initialValue);
  const applyDraft = () => {
    if (disabled) return;
    const result = editor.current?.commit();
    if (result?.ok) onApply(currentText.current);
  };
  const latestApply = React.useRef(applyDraft);
  latestApply.current = applyDraft;
  const ownedApply = React.useRef(() => latestApply.current());
  apply.current = ownedApply.current;
  React.useEffect(() => {
    const owned = ownedApply.current;
    return () => { if (apply.current === owned) apply.current = null; };
  }, [apply]);
  return <div onKeyDownCapture={event => {
    // Radix owns Escape dismissal at the anchored shell. The package's text
    // slot would otherwise discard its unfinished buffer before that shell's
    // explicit Keep/Discard choice, including invalid JSON.
    if (event.key === 'Escape' && event.target instanceof HTMLTextAreaElement) {
      event.preventDefault(); event.stopPropagation();
    }
  }}><JsonEditor value={document} rootName={column.key} label={`Edit ${column.label} JSON`}
    disabled={disabled} editorRef={editor} scrollMode="parent" density="compact" rawTextDraft={raw}
    validate={candidate => normalizeDataStudioValueForColumn(column, candidate)}
    onChange={next => {
      setDocument(next);
      admittedText.current = JSON.stringify(next);
      currentText.current = admittedText.current;
      onValueChange(currentText.current);
    }}
    onRawTextDraftChange={next => {
      setRaw(next);
      currentText.current = next ?? admittedText.current;
      onValueChange(currentText.current);
    }} /></div>;
}

function parseInitial(value: string): { value: DataStudioValue; raw: string | null } {
  if (!value.trim()) return { value: null, raw: null };
  try { return { value: JSON.parse(value) as DataStudioValue, raw: null }; }
  catch { return { value: null, raw: value }; }
}
