'use client';

/**
 * inline-edit-text.tsx
 *
 * A geometry-preserving text editor for dense management surfaces. Display
 * text remains in the layout while a native input overlays it, so editing and
 * save feedback never resize a row.
 */

import * as React from 'react';
import { AlertCircle, Check, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Button } from './button';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { cn } from '../../lib/utils';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';

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
  /** Existing blur commit remains default; explicit mode adds Check/X and never saves on blur. */
  readonly commitMode?: 'blur' | 'explicit';
  readonly scopeKey?: string | number;
  readonly onCommit: (value: string, context: InlineEditTextCommitContext) => void | Promise<unknown>;
  readonly onReload?: () => void | Promise<unknown>;
  readonly onNavigate?: (direction: -1 | 1) => void;
  readonly normalize?: (draft: string) => string;
  readonly isConflictError?: (cause: unknown) => boolean;
}

/** Backend adapters still independently authorize writes against the captured revision. */
export interface InlineEditTextCommitContext {
  readonly expectedRevision: string | number;
  readonly signal: AbortSignal;
}

/** Render an in-place text editor with optimistic, error, and conflict states. */
export function InlineEditText({
  value,
  revision,
  label,
  disabled = false,
  selected = false,
  commitMode = 'blur',
  scopeKey,
  placeholder = 'Untitled',
  className,
  onSelect,
  onCommit,
  onReload,
  onNavigate,
  normalize = requireNonEmptyText,
  isConflictError = defaultConflictDetector,
}: InlineEditTextProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const callbackBoundaryKey = JSON.stringify([boundary.key, scopeKey ?? null]);
  const latest = React.useRef({ client, scopeKey, disabled, value, revision });
  latest.current = { client, scopeKey, disabled, value, revision };
  const currentScope = React.useCallback((key: string) => {
    const current = latest.current, internal = current.client as InternalClient | null;
    const auth = internal?.auth ?? null, dataRevision = internal?._authorizationDataBoundary?.revision ?? 0;
    return JSON.stringify([readAuthorizationScopeBoundaryKey(auth, dataRevision), current.scopeKey ?? null]) === key
      && (!auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(dataRevision, auth.authorizationState.status, auth.isAuthenticated));
  }, []);
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
  const mounted = React.useRef(true);
  const inFlight = React.useRef<number | null>(null);
  const skipBlur = React.useRef(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveController = React.useRef<AbortController | null>(null);

  const displayValue = optimisticValue ?? value;

  React.useEffect(() => {
    if (optimisticValue !== null && optimisticValue === value) {
      setOptimisticValue(null);
    }
    if (!editing && state !== 'pending') setDraft(value);
  }, [editing, optimisticValue, state, value]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveController.current?.abort();
      saveSequence.current += 1;
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = null;
    };
  }, []);

  React.useEffect(() => {
    saveController.current?.abort(); saveController.current = null;
    saveSequence.current += 1; inFlight.current = null; editRevision.current = null;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = null; skipBlur.current = true;
    setEditing(false); setDraft(latest.current.value); setOptimisticValue(null); setState('idle'); setMessage(null);
  }, [callbackBoundaryKey]);

  React.useEffect(() => {
    if (!disabled) return;
    saveController.current?.abort(); saveController.current = null;
    saveSequence.current += 1; inFlight.current = null;
    setState('idle'); setMessage(null);
  }, [disabled]);

  React.useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const restoreFocus = React.useCallback(() => {
    const sequence = saveSequence.current;
    requestAnimationFrame(() => {
      if (mounted.current && sequence === saveSequence.current && currentScope(callbackBoundaryKey)) triggerRef.current?.focus();
    });
  }, [callbackBoundaryKey, currentScope]);

  const navigateAfterAcceptance = React.useCallback((move: -1 | 1) => {
    const sequence = saveSequence.current;
    const current = () => mounted.current && sequence === saveSequence.current && currentScope(callbackBoundaryKey);
    requestAnimationFrame(() => {
      if (!current()) return;
      try {
        void Promise.resolve(onNavigate?.(move)).catch(() => {
          if (current()) reportNotificationFailure('navigation');
        });
      } catch { if (current()) reportNotificationFailure('navigation'); }
    });
  }, [callbackBoundaryKey, currentScope, onNavigate]);

  const resetSavedTimer = React.useCallback(() => {
    if (!savedTimer.current) return;
    clearTimeout(savedTimer.current);
    savedTimer.current = null;
  }, []);

  const beginEdit = React.useCallback(() => {
    if (!mounted.current || !currentScope(callbackBoundaryKey)) return;
    onSelect?.();
    if (disabled || state === 'pending' || inFlight.current !== null) return;
    resetSavedTimer();
    saveSequence.current += 1;
    editRevision.current = revision;
    initialDraft.current = displayValue;
    skipBlur.current = false;
    setDraft(displayValue);
    setMessage(null);
    setState('idle');
    setEditing(true);
  }, [callbackBoundaryKey, currentScope, disabled, displayValue, onSelect, resetSavedTimer, revision, state]);

  const cancel = React.useCallback(() => {
    if (inFlight.current !== null) return;
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
    if (commitMode === 'explicit') {
      skipBlur.current = true;
      setOptimisticValue(null); setState('conflict');
      setMessage('This item changed elsewhere. Your draft is preserved. Reload the latest value before saving.');
      return;
    }
    editRevision.current = null;
    skipBlur.current = true;
    setOptimisticValue(null);
    setDraft(value);
    setEditing(false);
    setState('conflict');
    setMessage('This item changed elsewhere. The latest name was restored.');
    restoreFocus();
  }, [commitMode, resetSavedTimer, restoreFocus, value]);

  React.useEffect(() => {
    if (!editing || state === 'pending' || editRevision.current === null) return;
    if (commitMode === 'explicit' && state === 'conflict') return;
    if (editRevision.current !== revision) showConflict();
  }, [commitMode, editing, revision, showConflict, state]);

  const finishWithoutCommit = React.useCallback((move?: -1 | 1) => {
    skipBlur.current = true;
    editRevision.current = null;
    setEditing(false);
    setMessage(null);
    setState('idle');
    if (move) navigateAfterAcceptance(move);
    else restoreFocus();
  }, [navigateAfterAcceptance, restoreFocus]);

  const save = React.useCallback(async (move?: -1 | 1) => {
    if (!mounted.current || !currentScope(callbackBoundaryKey) || latest.current.disabled || disabled || inFlight.current !== null || state === 'pending') return;
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
    const controller = new AbortController(); saveController.current = controller;
    inFlight.current = sequence;
    skipBlur.current = true;
    setState('pending');
    setMessage(null);
    try {
      await Promise.resolve();
      if (!mounted.current || controller.signal.aborted || sequence !== saveSequence.current || latest.current.disabled || !currentScope(callbackBoundaryKey)) return;
      await onCommit(nextValue, { signal: controller.signal, expectedRevision: editRevision.current! });
      if (!mounted.current || controller.signal.aborted || sequence !== saveSequence.current || !currentScope(callbackBoundaryKey)) return;
      editRevision.current = null;
      setOptimisticValue(nextValue);
      setEditing(false);
      setState('saved');
      savedTimer.current = setTimeout(() => {
        if (mounted.current && sequence === saveSequence.current) setState('idle');
        savedTimer.current = null;
      }, 1200);
      if (move) navigateAfterAcceptance(move);
      else restoreFocus();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || sequence !== saveSequence.current || !currentScope(callbackBoundaryKey)) return;
      const conflict = isConflictError(cause);
      emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'inline-edit-text', stage: conflict ? 'conflict' : 'commit' } });
      if (commitMode === 'explicit') {
        setOptimisticValue(null); setState(conflict ? 'conflict' : 'error');
        setMessage(conflict ? 'This item changed elsewhere. Your draft is preserved. Reload the latest value before saving.'
          : 'This value could not be saved. Your draft is preserved.');
        inputRef.current?.focus();
        return;
      }
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
        if (mounted.current && sequence === saveSequence.current) reportNotificationFailure('reload');
      }
      if (mounted.current && sequence === saveSequence.current) restoreFocus();
    } finally {
      if (inFlight.current === sequence) inFlight.current = null;
      if (saveController.current === controller) saveController.current = null;
    }
  }, [
    disabled,
    callbackBoundaryKey,
    commitMode,
    currentScope,
    draft,
    finishWithoutCommit,
    isConflictError,
    normalize,
    onCommit,
    navigateAfterAcceptance,
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
          className={cn('absolute inset-0 size-full min-w-0 appearance-none rounded-sm border-0 bg-transparent px-1 py-1 font-inherit text-inherit leading-inherit outline-none ring-2 ring-inset ring-primary/55 disabled:opacity-70', commitMode === 'explicit' && 'pr-14')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const action = resolveInlineEditTextKeyAction(
              event.key,
              event.shiftKey,
              event.nativeEvent.isComposing,
              commitMode,
            );
            if (!action) return;
            event.preventDefault();
            if (action.type === 'cancel') cancel();
            else void save(action.type === 'save-and-move' ? action.direction : undefined);
          }}
          onBlur={() => {
            if (commitMode === 'explicit') return;
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            void save();
          }}
        />
      )}

      {editing && commitMode === 'explicit' && <div className="absolute inset-y-0 right-0 z-10 flex items-center gap-0.5 rounded-sm bg-background/95 px-0.5">
        {state === 'conflict' ? <Button type="button" size="icon-xs" variant="ghost" aria-label={`Reload ${label}`}
          disabled={disabled} onPointerDown={event => event.preventDefault()}
          onClick={() => {
            const sequence = ++saveSequence.current;
            void Promise.resolve().then(() => onReload?.()).then(() => {
              if (!mounted.current || sequence !== saveSequence.current || !currentScope(callbackBoundaryKey)) return;
              setDraft(latest.current.value); editRevision.current = latest.current.revision;
              initialDraft.current = latest.current.value; setState('idle'); setMessage(null); inputRef.current?.focus();
            }).catch(() => { if (mounted.current && currentScope(callbackBoundaryKey)) reportNotificationFailure('reload'); });
          }}><RefreshCw aria-hidden="true" /></Button>
          : <Button type="button" size="icon-xs" variant="ghost" aria-label={`Save ${label}`}
            disabled={disabled || state === 'pending' || draft === initialDraft.current}
            onPointerDown={event => event.preventDefault()} onClick={() => { void save(); }}>
            {state === 'pending' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Check aria-hidden="true" />}</Button>}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Cancel ${label}`} disabled={disabled || state === 'pending'}
          onPointerDown={event => { skipBlur.current = true; event.preventDefault(); }} onClick={cancel}><X aria-hidden="true" /></Button>
      </div>}

      {editing && commitMode === 'explicit' ? <span role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}
        className="sr-only">{state === 'pending' ? `Saving ${label}` : message}</span>
        : <InlineEditTextIndicator state={state} message={message} />}
    </div>
  );
}

function reportNotificationFailure(stage: 'navigation' | 'reload'): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
    metadata: { surface: 'inline-edit-text', stage },
  });
}

/** Resolve keyboard input into the editor's save, move, or cancel command. */
export function resolveInlineEditTextKeyAction(
  key: string,
  shiftKey = false,
  isComposing = false,
  commitMode: 'blur' | 'explicit' = 'blur',
): InlineEditTextKeyAction {
  if (isComposing) return null;
  if (key === 'Enter') return { type: 'save' };
  if (key === 'Tab') return commitMode === 'explicit' ? null : { type: 'save-and-move', direction: shiftKey ? -1 : 1 };
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
      ? message ?? 'Conflict; latest value restored'
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
      <Icon className={cn('size-3', state === 'pending' && 'motion-safe:animate-spin')} aria-hidden="true" />
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
