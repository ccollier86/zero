'use client';

/**
 * inline-edit-text.tsx
 *
 * A geometry-preserving text editor for dense management surfaces. Display
 * text remains in the layout while a native input overlays it, so editing and
 * save feedback never resize a row.
 */

import * as React from 'react';
import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

export type InlineEditTextState =
  | 'idle'
  | 'pending'
  | 'saved'
  | 'error'
  | 'conflict';

export type InlineEditTextKeyAction =
  | { readonly type: 'save' }
  | { readonly type: 'save-and-move'; readonly direction: -1 | 1 }
  | { readonly type: 'cancel' }
  | null;

export interface InlineEditTextProps {
  readonly value: string;
  readonly revision: string | number;
  readonly label: string;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly onSelect?: () => void;
  readonly onCommit: (value: string) => void | Promise<unknown>;
  readonly onReload?: () => void | Promise<unknown>;
  readonly onNavigate?: (direction: -1 | 1) => void;
  readonly normalize?: (draft: string) => string;
  readonly isConflictError?: (cause: unknown) => boolean;
}

/** Render an in-place text editor with optimistic, error, and conflict states. */
export function InlineEditText({
  value,
  revision,
  label,
  disabled = false,
  selected = false,
  placeholder = 'Untitled',
  className,
  onSelect,
  onCommit,
  onReload,
  onNavigate,
  normalize = requireNonEmptyText,
  isConflictError = defaultConflictDetector,
}: InlineEditTextProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [optimisticValue, setOptimisticValue] = React.useState<string | null>(null);
  const [state, setState] = React.useState<InlineEditTextState>('idle');
  const [message, setMessage] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const editRevision = React.useRef<string | number | null>(null);
  const initialDraft = React.useRef(value);
  const saveSequence = React.useRef(0);
  const skipBlur = React.useRef(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayValue = optimisticValue ?? value;

  React.useEffect(() => {
    if (optimisticValue !== null && optimisticValue === value) {
      setOptimisticValue(null);
    }
    if (!editing && state !== 'pending') setDraft(value);
  }, [editing, optimisticValue, state, value]);

  React.useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  React.useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const restoreFocus = React.useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const resetSavedTimer = React.useCallback(() => {
    if (!savedTimer.current) return;
    clearTimeout(savedTimer.current);
    savedTimer.current = null;
  }, []);

  const beginEdit = React.useCallback(() => {
    onSelect?.();
    if (disabled || state === 'pending') return;
    resetSavedTimer();
    saveSequence.current += 1;
    editRevision.current = revision;
    initialDraft.current = displayValue;
    skipBlur.current = false;
    setDraft(displayValue);
    setMessage(null);
    setState('idle');
    setEditing(true);
  }, [disabled, displayValue, onSelect, resetSavedTimer, revision, state]);

  const cancel = React.useCallback(() => {
    saveSequence.current += 1;
    resetSavedTimer();
    editRevision.current = null;
    skipBlur.current = true;
    setDraft(displayValue);
    setEditing(false);
    setMessage(null);
    setState('idle');
    restoreFocus();
  }, [displayValue, resetSavedTimer, restoreFocus]);

  const showConflict = React.useCallback(() => {
    saveSequence.current += 1;
    resetSavedTimer();
    editRevision.current = null;
    skipBlur.current = true;
    setOptimisticValue(null);
    setDraft(value);
    setEditing(false);
    setState('conflict');
    setMessage('This item changed elsewhere. The latest name was restored.');
    restoreFocus();
  }, [resetSavedTimer, restoreFocus, value]);

  React.useEffect(() => {
    if (!editing || state === 'pending' || editRevision.current === null) return;
    if (editRevision.current !== revision) showConflict();
  }, [editing, revision, showConflict, state]);

  const finishWithoutCommit = React.useCallback((move?: -1 | 1) => {
    skipBlur.current = true;
    editRevision.current = null;
    setEditing(false);
    setMessage(null);
    setState('idle');
    if (move) requestAnimationFrame(() => onNavigate?.(move));
    else restoreFocus();
  }, [onNavigate, restoreFocus]);

  const save = React.useCallback(async (move?: -1 | 1) => {
    if (state === 'pending') return;
    if (editRevision.current !== revision) {
      showConflict();
      return;
    }

    let nextValue: string;
    try {
      nextValue = normalize(draft);
    } catch (cause) {
      setState('error');
      setMessage(errorMessage(cause));
      inputRef.current?.focus();
      return;
    }
    if (nextValue === initialDraft.current) {
      finishWithoutCommit(move);
      return;
    }

    resetSavedTimer();
    const sequence = ++saveSequence.current;
    skipBlur.current = true;
    setState('pending');
    setMessage(null);
    try {
      await onCommit(nextValue);
      if (sequence !== saveSequence.current) return;
      editRevision.current = null;
      setOptimisticValue(nextValue);
      setEditing(false);
      setState('saved');
      savedTimer.current = setTimeout(() => {
        if (sequence === saveSequence.current) setState('idle');
        savedTimer.current = null;
      }, 1200);
      if (move) requestAnimationFrame(() => onNavigate?.(move));
      else restoreFocus();
    } catch (cause) {
      if (sequence !== saveSequence.current) return;
      const conflict = isConflictError(cause);
      editRevision.current = null;
      setOptimisticValue(null);
      setDraft(value);
      setEditing(false);
      setState(conflict ? 'conflict' : 'error');
      setMessage(conflict
        ? 'This item changed elsewhere. The latest name was restored.'
        : errorMessage(cause));
      try {
        await onReload?.();
      } catch {
        // The original mutation remains the actionable error.
      }
      restoreFocus();
    }
  }, [
    draft,
    finishWithoutCommit,
    isConflictError,
    normalize,
    onCommit,
    onNavigate,
    onReload,
    resetSavedTimer,
    restoreFocus,
    revision,
    showConflict,
    state,
    value,
  ]);

  return (
    <div
      data-slot="inline-edit-text"
      data-save-state={state}
      className={cn(
        'group/inline-edit relative min-h-7 min-w-0 rounded-sm px-1 py-1 font-inherit text-inherit leading-inherit',
        selected && 'bg-primary/5',
        state === 'error' && 'bg-destructive/5',
        state === 'conflict' && 'bg-warning/10',
        className,
      )}
      title={message ?? undefined}
    >
      <span
        aria-hidden={editing ? 'true' : undefined}
        className={cn(
          'block min-h-5 truncate whitespace-nowrap',
          !displayValue && 'text-muted-foreground/70 italic',
          editing && 'invisible',
        )}
      >
        {displayValue || placeholder || '\u00a0'}
      </span>

      {!editing && (
        <button
          ref={triggerRef}
          type="button"
          className="absolute inset-0 size-full cursor-text rounded-sm bg-transparent p-0 text-left outline-none ring-inset hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-wait"
          disabled={state === 'pending'}
          aria-label={`${disabled ? 'Select' : 'Edit'} ${label}, current value ${displayValue || placeholder}`}
          onClick={beginEdit}
        >
          <span className="sr-only">{disabled ? 'Select' : 'Edit'} {label}</span>
        </button>
      )}

      {editing && (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={disabled || state === 'pending'}
          aria-label={`Edit ${label}`}
          aria-invalid={state === 'error' || state === 'conflict'}
          className="absolute inset-0 size-full min-w-0 appearance-none rounded-sm border-0 bg-transparent px-1 py-1 font-inherit text-inherit leading-inherit outline-none ring-2 ring-inset ring-primary/55 disabled:opacity-70"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const action = resolveInlineEditTextKeyAction(
              event.key,
              event.shiftKey,
              event.nativeEvent.isComposing,
            );
            if (!action) return;
            event.preventDefault();
            if (action.type === 'cancel') cancel();
            else void save(action.type === 'save-and-move' ? action.direction : undefined);
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            void save();
          }}
        />
      )}

      <InlineEditTextIndicator state={state} message={message} />
    </div>
  );
}

/** Resolve keyboard input into the editor's save, move, or cancel command. */
export function resolveInlineEditTextKeyAction(
  key: string,
  shiftKey = false,
  isComposing = false,
): InlineEditTextKeyAction {
  if (isComposing) return null;
  if (key === 'Enter') return { type: 'save' };
  if (key === 'Tab') return { type: 'save-and-move', direction: shiftKey ? -1 : 1 };
  if (key === 'Escape') return { type: 'cancel' };
  return null;
}

function InlineEditTextIndicator({
  state,
  message,
}: {
  state: InlineEditTextState;
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

function requireNonEmptyText(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('A name is required.');
  return normalized;
}

function defaultConflictDetector(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { code?: unknown; status?: unknown };
  return candidate.status === 409
    || candidate.code === 'CONFLICT'
    || candidate.code === 'REVISION_CONFLICT';
}

function errorMessage(value: unknown): string {
  return value instanceof Error && value.message
    ? value.message
    : 'Save failed. The previous value was restored.';
}
