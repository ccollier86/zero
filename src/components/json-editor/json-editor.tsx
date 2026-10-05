'use client';

/** Packaged structured JSON editor; local admission and retained text are separate from persistence. */
import * as React from 'react';
import { JsonEditor as PackagedJsonEditor, type JsonEditorHandle as PackageHandle } from 'json-edit-react';
import { Braces } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { ZERO_JSON_EDITOR_THEME } from './json-editor-theme';
import { JsonSelect, JsonTextEditor, JsonTextDraftContext } from './json-editor-widgets';
import type { JsonEditorCommitResult, JsonEditorProps } from './json-editor.types';

export function JsonEditor<T = unknown>({
  value, onChange, validate, disabled = false, label = 'JSON editor', rootName = 'schema',
  collapse = 3, className, rawTextDraft, onRawTextDraftChange, onEditingChange, editorRef,
  scrollMode = 'self',
}: JsonEditorProps<T>) {
  const packageRef = React.useRef<PackageHandle>(null);
  const current = React.useRef({ value, onChange, validate, disabled, onRawTextDraftChange, onEditingChange });
  current.current = { value, onChange, validate, disabled, onRawTextDraftChange, onEditingChange };
  const document = React.useRef(value); document.current = value;
  const raw = React.useRef<string | null>(rawTextDraft ?? null);
  if (rawTextDraft !== undefined) raw.current = rawTextDraft;
  const [error, setError] = React.useState<string | null>(null);
  const errorRef = React.useRef<string | null>(null);
  const editing = React.useRef(false), mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const fail = (message: string) => { errorRef.current = message; if (mounted.current) setError(message); };
  const observe = (stage: string, callback: (() => unknown) | undefined) => {
    try {
      const result = callback?.();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => emitFrontendCode(OBS_CODES.FRONTEND_JSON_EDITOR_CALLBACK_FAILED, { metadata: { stage } }));
      }
    }
    catch { emitFrontendCode(OBS_CODES.FRONTEND_JSON_EDITOR_CALLBACK_FAILED, { metadata: { stage } }); }
  };
  const setRaw = (next: string | null) => {
    raw.current = next;
    observe('text-draft', () => current.current.onRawTextDraftChange?.(next));
  };
  const accept = (next: T) => {
    if (!mounted.current || current.current.disabled) return;
    document.current = next; setRaw(null); errorRef.current = null; setError(null);
    try {
      const result: unknown = current.current.onChange(next);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => emitFrontendCode(OBS_CODES.FRONTEND_JSON_EDITOR_CALLBACK_FAILED, { metadata: { stage: 'document' } }));
      }
    }
    catch {
      fail('The local document callback failed. Your draft has not been saved.');
      emitFrontendCode(OBS_CODES.FRONTEND_JSON_EDITOR_CALLBACK_FAILED, { metadata: { stage: 'document' } });
    }
  };
  const admit = (candidate: unknown): T => current.current.validate ? current.current.validate(candidate) : candidate as T;
  const commit = (): JsonEditorCommitResult<T> => {
    if (!mounted.current || current.current.disabled) return { ok: false, error: 'This editor is unavailable.' };
    errorRef.current = null;
    // Check the retained buffer first: a codec veto must not make JER discard it.
    if (raw.current !== null) {
      try { admit(JSON.parse(raw.current)); }
      catch (cause) {
        const message = cause instanceof SyntaxError ? 'Invalid JSON. Check commas, quotes and matching braces.' : messageOf(cause);
        fail(message); return { ok: false, error: message };
      }
    }
    // Structural type edits may emit commitEdit while leaving a new input open.
    // Flush the live handle rather than infer its state from one event name.
    packageRef.current?.confirm();
    if (!editing.current && raw.current !== null) {
      try { accept(JSON.parse(raw.current) as T); }
      catch (cause) { fail(messageOf(cause)); }
    }
    if (errorRef.current) return { ok: false, error: errorRef.current };
    if (editing.current) return { ok: false, error: 'Finish or cancel the open JSON edit before continuing.' };
    try { return { ok: true, value: admit(document.current) }; }
    catch (cause) { const message = messageOf(cause); fail(message); return { ok: false, error: message }; }
  };
  const startTextEdit = () => {
    if (mounted.current && !current.current.disabled) packageRef.current?.startEdit({ path: [] });
  };
  React.useImperativeHandle(editorRef, () => ({ commit, startTextEdit, cancel: () => {
    if (!mounted.current || current.current.disabled) return;
    packageRef.current?.cancel(); setRaw(null); errorRef.current = null; setError(null);
  } }));
  React.useEffect(() => { if (raw.current !== null) startTextEdit(); }, []);

  return <div data-slot="json-editor" role="group" aria-label={label}
    className={cn('min-w-0 rounded-lg border border-border bg-background', className)}>
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Structured JSON</span>
      <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={startTextEdit}>
        <Braces className="size-3.5" aria-hidden="true" />Edit as text
      </Button>
    </div>
    <JsonTextDraftContext.Provider value={{ raw, disabled, label: label + ' text', change: text => {
      if (!mounted.current || current.current.disabled) return;
      setRaw(text); errorRef.current = null; setError(null);
    } }}>
      <fieldset disabled={disabled} className={cn('min-w-0 p-2', scrollMode === 'self' && 'max-h-[28rem] overflow-auto')}>
        <PackagedJsonEditor<T> data={value} setData={accept} theme={ZERO_JSON_EDITOR_THEME}
          rootName={rootName} collapse={collapse} minWidth={0} maxWidth="100%" baseFontSize="13px"
          allowEdit={!disabled} allowAdd={!disabled} allowDelete={!disabled} allowDrag={false}
          TextEditor={JsonTextEditor} Select={JsonSelect} editorRef={packageRef}
          onUpdate={() => current.current.disabled ? null : undefined}
          onError={({ error: failure }) => fail(failure.message)}
          onEditEvent={({ event }) => {
            if (!mounted.current) return;
            if (event.startsWith('start')) editing.current = true;
            if (event.startsWith('commit') || event.startsWith('cancel')) editing.current = false;
            if (event.startsWith('cancel')) { setRaw(null); errorRef.current = null; setError(null); }
            observe('editing', () => current.current.onEditingChange?.(editing.current));
          }} />
      </fieldset>
    </JsonTextDraftContext.Provider>
    {error && <p role="alert" className="border-t border-destructive/20 px-3 py-2 text-xs text-destructive">{error}</p>}
  </div>;
}

function messageOf(cause: unknown) { return cause instanceof Error && cause.message ? cause.message : 'Review the JSON document.'; }
