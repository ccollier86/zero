'use client';

import * as React from 'react';
import { AlertCircle, Check, LoaderCircle, Minus, RefreshCw } from 'lucide-react';
import {
  isDataStudioRevisionConflict,
  type DataStudioColumn,
  type DataStudioValue,
} from '../../frontend/client/data-studio-client';
import { cn } from '../../lib/utils';
import {
  dataStudioValueDraft,
  formatDataStudioValue,
  parseDataStudioValueDraft,
} from './data-studio-value';

export type DataStudioCellSaveState =
  | 'idle'
  | 'pending'
  | 'saved'
  | 'error'
  | 'conflict';

export type DataStudioCellKeyAction =
  | { readonly type: 'save' }
  | { readonly type: 'save-and-move'; readonly direction: -1 | 1 }
  | { readonly type: 'cancel' }
  | null;

export interface DataStudioInlineCellProps {
  readonly value: DataStudioValue | undefined;
  readonly column: DataStudioColumn;
  /** Authoritative row revision captured when an edit begins. */
  readonly revision: number;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  readonly onCommit: (value: DataStudioValue) => Promise<unknown>;
  readonly onReload?: () => Promise<unknown>;
  readonly onNavigate?: (direction: -1 | 1) => void;
  readonly className?: string;
}

/**
 * Edit a value in place without swapping in the framework's decorated Input.
 * The hidden display text keeps the cell's geometry stable while the native
 * editor overlays the same box with inherited typography.
 */
export function DataStudioInlineCell({
  value,
  column,
  revision,
  disabled = false,
  selected = false,
  onSelect,
  onCommit,
  onReload,
  onNavigate,
  className,
}: DataStudioInlineCellProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => dataStudioValueDraft(value, column));
  const [state, setState] = React.useState<DataStudioCellSaveState>('idle');
  const [message, setMessage] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const skipBlur = React.useRef(false);
  const saveRevision = React.useRef(0);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const editRevision = React.useRef<number | null>(null);
  const initialDraft = React.useRef(draft);
  const draftDirty = React.useRef(false);
  const editCommit = React.useRef(onCommit);

  const clearSavedTimer = React.useCallback(() => {
    if (!savedTimer.current) return;
    clearTimeout(savedTimer.current);
    savedTimer.current = null;
  }, []);

  React.useEffect(() => {
    if (!editing && state !== 'pending') setDraft(dataStudioValueDraft(value, column));
  }, [column, editing, state, value]);

  React.useEffect(() => clearSavedTimer, [clearSavedTimer]);

  React.useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const beginEdit = React.useCallback(() => {
    onSelect?.();
    if (disabled || state === 'pending') return;
    saveRevision.current += 1;
    clearSavedTimer();
    skipBlur.current = false;
    const nextDraft = dataStudioValueDraft(value, column);
    initialDraft.current = nextDraft;
    draftDirty.current = false;
    editRevision.current = revision;
    editCommit.current = onCommit;
    setDraft(nextDraft);
    setMessage(null);
    setState('idle');
    setEditing(true);
  }, [clearSavedTimer, column, disabled, onCommit, onSelect, revision, state, value]);

  const cancel = React.useCallback(() => {
    saveRevision.current += 1;
    clearSavedTimer();
    skipBlur.current = true;
    editRevision.current = null;
    draftDirty.current = false;
    setDraft(dataStudioValueDraft(value, column));
    setMessage(null);
    setState('idle');
    setEditing(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [clearSavedTimer, column, value]);

  const showAuthoritativeConflict = React.useCallback(() => {
    saveRevision.current += 1;
    clearSavedTimer();
    skipBlur.current = true;
    editRevision.current = null;
    draftDirty.current = false;
    setDraft(dataStudioValueDraft(value, column));
    setEditing(false);
    setState('conflict');
    setMessage('This record changed elsewhere. The latest value was restored.');
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [clearSavedTimer, column, value]);

  React.useEffect(() => {
    if (!editing
      || state === 'pending'
      || editRevision.current === null
      || editRevision.current === revision) return;
    showAuthoritativeConflict();
  }, [editing, revision, showAuthoritativeConflict, state]);

  const finishWithoutCommit = React.useCallback((
    move?: -1 | 1,
    restoreFocus = false,
  ) => {
    skipBlur.current = true;
    editRevision.current = null;
    draftDirty.current = false;
    setEditing(false);
    setMessage(null);
    setState('idle');
    if (move) requestAnimationFrame(() => onNavigate?.(move));
    else if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onNavigate]);

  const saveValue = React.useCallback(async (
    nextValue: DataStudioValue,
    move?: -1 | 1,
    restoreFocus = false,
    commit: DataStudioInlineCellProps['onCommit'] = editCommit.current,
  ) => {
    if (state === 'pending') return;
    clearSavedTimer();
    const requestRevision = ++saveRevision.current;
    skipBlur.current = true;
    setState('pending');
    setMessage(null);
    try {
      await commit(nextValue);
      if (saveRevision.current !== requestRevision) return;
      editRevision.current = null;
      draftDirty.current = false;
      setEditing(false);
      setState('saved');
      savedTimer.current = setTimeout(() => {
        if (saveRevision.current !== requestRevision) return;
        savedTimer.current = null;
        setState('idle');
      }, 1200);
      if (move) requestAnimationFrame(() => onNavigate?.(move));
      else if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (cause) {
      if (saveRevision.current !== requestRevision) return;
      editRevision.current = null;
      draftDirty.current = false;
      const conflict = isDataStudioRevisionConflict(cause);
      setEditing(false);
      setDraft(dataStudioValueDraft(value, column));
      setState(conflict ? 'conflict' : 'error');
      setMessage(conflict
        ? 'This record changed elsewhere. The latest value was restored.'
        : errorMessage(cause));
      try {
        await onReload?.();
      } catch {
        // Preserve the original mutation error; the controller also exposes
        // the reload failure at the workspace boundary.
      }
      if (restoreFocus || move) requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, [clearSavedTimer, column, onNavigate, onReload, state, value]);

  const saveDraft = React.useCallback(async (
    move?: -1 | 1,
    restoreFocus = false,
  ) => {
    if (editRevision.current !== null
      && editRevision.current !== revision) {
      showAuthoritativeConflict();
      return;
    }
    // A blank draft can represent absent, null, or the empty string. An
    // untouched blank remains an exact no-op, but typing and deleting back to
    // blank is an intentional edit and must be parsed/committed.
    if (draft === initialDraft.current && !(draft === '' && draftDirty.current)) {
      finishWithoutCommit(move, restoreFocus);
      return;
    }
    let parsed: DataStudioValue;
    try {
      parsed = parseDataStudioValueDraft(draft, column);
    } catch (cause) {
      setState('error');
      setMessage(errorMessage(cause));
      inputRef.current?.focus();
      return;
    }
    await saveValue(parsed, move, restoreFocus);
  }, [column, draft, finishWithoutCommit, revision, saveValue, showAuthoritativeConflict]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    const action = resolveDataStudioCellKeyAction(
      event.key,
      event.shiftKey,
      event.nativeEvent.isComposing,
    );
    if (!action) return;
    event.preventDefault();
    if (action.type === 'cancel') {
      cancel();
      return;
    }
    void saveDraft(
      action.type === 'save-and-move' ? action.direction : undefined,
      action.type === 'save',
    );
  }, [cancel, saveDraft]);

  const display = formatDataStudioValue(value, column);
  const isBoolean = column.type === 'boolean';
  const booleanValue = value === true ? true : value === false ? false : null;
  const nextBooleanValue = booleanValue === true
    ? false
    : booleanValue === false && !column.required ? null : true;

  return (
    <div
      data-slot="data-studio-inline-cell"
      data-save-state={state}
      className={cn(
        'group/cell relative min-h-7 min-w-0 rounded-sm px-1 py-1 font-inherit text-inherit leading-inherit',
        selected && 'bg-primary/5',
        state === 'error' && 'bg-destructive/5',
        state === 'conflict' && 'bg-warning/10',
        className,
      )}
      title={message ?? undefined}
    >
      {isBoolean ? (
        <button
          ref={triggerRef}
          type="button"
          data-data-studio-cell="true"
          className={cn(
            'flex h-5 w-full items-center bg-transparent p-0 text-left font-inherit text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed',
            disabled && 'cursor-default',
          )}
          disabled={state === 'pending'}
          aria-label={`${disabled ? 'Select' : 'Edit'} ${column.label}`}
          aria-pressed={booleanValue ?? 'mixed'}
          onClick={() => {
            onSelect?.();
            if (!disabled) void saveValue(nextBooleanValue, undefined, true, onCommit);
          }}
        >
          <span className={cn(
            'flex size-4 items-center justify-center rounded border transition-colors',
            booleanValue === true
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background',
          )}>
            {booleanValue === true && <Check className="size-3" aria-hidden="true" />}
            {booleanValue === null && <Minus className="size-3 text-muted-foreground" aria-hidden="true" />}
          </span>
          <span className="sr-only">
            {booleanValue === null ? (value === null ? 'Null' : 'Empty') : booleanValue ? 'True' : 'False'}
          </span>
        </button>
      ) : (
        <>
          <span
            aria-hidden={editing ? 'true' : undefined}
            className={cn(
              'block min-h-5 truncate whitespace-nowrap',
              value == null && 'text-muted-foreground/70 italic',
              editing && 'invisible',
            )}
          >
            {display || '\u00a0'}
          </span>
          {!editing && (
            <button
              ref={triggerRef}
              type="button"
              data-data-studio-cell="true"
              className="absolute inset-0 size-full cursor-text rounded-sm bg-transparent p-0 text-left outline-none ring-inset hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed"
              disabled={state === 'pending'}
              aria-label={`${disabled ? 'Select' : 'Edit'} ${column.label}${display ? `, current value ${display}` : ''}`}
              onClick={beginEdit}
            >
              <span className="sr-only">Edit {column.label}</span>
            </button>
          )}
          {editing && (
            <input
              ref={inputRef}
              type={inlineInputType(column)}
              step={column.type === 'number'
                ? 'any'
                : column.type === 'datetime'
                  ? '0.001'
                  : undefined}
              value={draft}
              disabled={disabled || state === 'pending'}
              aria-label={`Edit ${column.label}`}
              aria-invalid={state === 'error' || state === 'conflict'}
              className="absolute inset-0 size-full min-w-0 appearance-none rounded-sm border-0 bg-transparent px-1 py-1 font-inherit text-inherit leading-inherit outline-none ring-2 ring-inset ring-primary/55 placeholder:text-muted-foreground/60 disabled:opacity-70"
              onChange={(event) => {
                draftDirty.current = true;
                setDraft(event.target.value);
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (skipBlur.current) {
                  skipBlur.current = false;
                  return;
                }
                void saveDraft();
              }}
            />
          )}
        </>
      )}
      <CellStateIndicator state={state} message={message} />
    </div>
  );
}

export function resolveDataStudioCellKeyAction(
  key: string,
  shiftKey = false,
  isComposing = false,
): DataStudioCellKeyAction {
  if (isComposing) return null;
  if (key === 'Enter') return { type: 'save' };
  if (key === 'Tab') return { type: 'save-and-move', direction: shiftKey ? -1 : 1 };
  if (key === 'Escape') return { type: 'cancel' };
  return null;
}

function CellStateIndicator({
  state,
  message,
}: {
  state: DataStudioCellSaveState;
  message: string | null;
}) {
  if (state === 'idle') return null;
  const Icon = state === 'pending'
    ? LoaderCircle
    : state === 'saved'
      ? Check
      : state === 'conflict'
        ? RefreshCw
        : AlertCircle;
  const label = state === 'pending'
    ? 'Saving'
    : state === 'saved'
      ? 'Saved'
      : state === 'conflict'
        ? 'Conflict; latest value restored'
        : message ?? 'Save failed; previous value restored';
  return (
    <span
      role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-none absolute right-0.5 top-0.5 z-10 rounded-full bg-background/90 p-0.5 shadow-sm',
        state === 'saved' && 'text-success',
        state === 'pending' && 'text-muted-foreground',
        state === 'error' && 'text-destructive',
        state === 'conflict' && 'text-warning',
      )}
    >
      <Icon className={cn('size-3', state === 'pending' && 'animate-spin')} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function inlineInputType(column: DataStudioColumn): React.HTMLInputTypeAttribute {
  switch (column.type) {
    case 'number': return 'number';
    case 'date': return 'date';
    case 'datetime': return 'datetime-local';
    default: return 'text';
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error && value.message
    ? value.message
    : 'Save failed. The previous value was restored.';
}
