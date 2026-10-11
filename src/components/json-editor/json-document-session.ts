/**
 * Local source-aware document/draft/history session. Consumes synchronous admission and
 * an optional application-owned accepted writer; owns no endpoint, authorization
 * or reactive database subscription. Retired/disabled saves cannot admit feedback.
 */
import { cloneJsonDocument, diffJsonDocument, equalJsonDocument, JSON_DOCUMENT_LIMITS, jsonPointer, mutateJsonDocument, readJsonPath, type JsonMutation } from './json-document-model';
import { parseJsonDocument } from './json-document-source';
import { parseDocumentSource, readSourceDocument, writeSourceDocument, documentNeedsExactNumbers } from './document-source';
import { boundSource } from './document-source-contract';
import type { DocumentFormat } from './document.types';
import { losesDocumentNumberPrecision } from './document-number-precision';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import type { JsonDocumentEditorProps, JsonDocumentPath, JsonDocumentValue } from './json-document.types';
import type { JsonEditorCommitResult } from './json-editor.types';

export type JsonInlineType = 'auto' | 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export interface JsonInlineDraft { readonly kind: 'value' | 'key'; readonly path: JsonDocumentPath; readonly text: string; readonly type: JsonInlineType; readonly fresh?: boolean }
interface History { readonly value: JsonDocumentValue; readonly raw: string | null; readonly format: DocumentFormat; readonly text: string; readonly cache: Readonly<Partial<Record<DocumentFormat, string>>>; readonly draftValid: boolean }
export interface JsonDocumentSnapshot extends History {
  readonly baseline: JsonDocumentValue;
  readonly baselineFormat: DocumentFormat;
  readonly baselineText: string;
  readonly edit: JsonInlineDraft | null;
  readonly error: string | null;
  readonly notice: string;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly conflict: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
}
type Options = Pick<JsonDocumentEditorProps, 'onChange' | 'validate' | 'validateEdit' | 'onSave' | 'disabled' | 'onEditingChange' | 'onRawTextDraftChange' | 'onSourceChange'>;
const message = (error: unknown) => error instanceof Error && error.message ? error.message : 'Review the JSON document.';

/** Mutable ownership is confined to this local session; observers receive one immutable snapshot per transition. */
export class JsonDocumentSession {
  private state: JsonDocumentSnapshot;
  private options: Options;
  private readonly listeners = new Set<() => void>();
  private undoStack: History[] = [];
  private redoStack: History[] = [];
  private incoming: { value: JsonDocumentValue; text: string; format: DocumentFormat } | undefined;
  private generation = 0;
  private retired = false;
  private pending: AbortController | null = null;
  private codeTransaction = false;
  private fresh: History | null = null;
  constructor(value: JsonDocumentValue | undefined, options: Options, raw: string | null = null, source?: { format: DocumentFormat; text?: string }) {
    const format = source?.format ?? 'json';
    if (source?.text !== undefined) boundSource(source.text);
    if (raw !== null) boundSource(raw);
    const parsed = source?.text !== undefined ? parseDocumentSource(source.text, format) : null;
    if (parsed?.ok && value !== undefined && !equalJsonDocument(cloneJsonDocument(value), parsed.value)) throw new Error('The source text and supplied document value must agree.');
    const admitted = cloneJsonDocument(parsed?.ok ? parsed.value : value === undefined ? {} : value);
    const text = parsed?.ok ? source!.text! : writeSourceDocument(admitted, format);
    if (parsed && !parsed.ok) raw = source!.text!;
    const draft = raw !== null ? parseDocumentSource(raw, format) : null;
    this.options = options;
    this.state = { value: admitted, baseline: cloneJsonDocument(admitted), format, text, baselineFormat: format, baselineText: source?.text ?? text,
      cache: { [format]: text }, raw, draftValid: !draft || draft.ok && equalJsonDocument(draft.value, admitted), edit: null,
      error: draft && !draft.ok ? draft.message : null, notice: '', saving: false, saved: false,
      conflict: false, undoCount: 0, redoCount: 0 };
  }
  get dirty() { return this.state.raw !== null || this.state.edit !== null || this.state.format !== this.state.baselineFormat || this.state.text !== this.state.baselineText || !equalJsonDocument(this.state.value, this.state.baseline); }
  get document() { return readSourceDocument(this.state.text, this.state.format); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<JsonDocumentSnapshot>) {
    if (this.retired) return;
    this.state = { ...this.state, ...patch, undoCount: this.undoStack.length, redoCount: this.redoStack.length };
    for (const listener of this.listeners) listener();
  }
  private observe(stage: string, callback: (() => unknown) | undefined) {
    if (this.retired) return;
    try {
      const result = callback?.();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => this.report(stage));
    } catch { this.report(stage); }
  }
  private report(stage: string) { emitFrontendCode(OBS_CODES.FRONTEND_JSON_EDITOR_CALLBACK_FAILED, { metadata: { stage } }); }
  private editing(editing: boolean) { this.observe('document-editing', () => this.options.onEditingChange?.(editing)); }
  private raw(raw: string | null) { this.observe('document-text-draft', () => this.options.onRawTextDraftChange?.(raw)); }
  private available() { return !this.retired && !this.options.disabled; }
  private history(): History { const { format, text, cache, draftValid } = this.state; return { value: cloneJsonDocument(this.state.value), raw: this.state.raw, format, text, cache, draftValid }; }
  private remember() {
    this.undoStack.push(this.history());
    if (this.undoStack.length > JSON_DOCUMENT_LIMITS.history) this.undoStack.shift();
    // Bound retained snapshots as well as the count; large documents keep fewer undo steps.
    let size = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      size += JSON.stringify(this.undoStack[i]!.value).length + (this.undoStack[i]!.raw?.length ?? 0) + Object.values(this.undoStack[i]!.cache).reduce((size, text) => size + text.length, 0);
      if (size > 4_000_000) { this.undoStack.splice(0, i + 1); break; }
    }
    this.redoStack = [];
  }
  private accept(value: JsonDocumentValue, raw: string | null, remember = true, history?: History, rename?: { from: string; to: string }): boolean {
    try { value = cloneJsonDocument(value); }
    catch (error) { this.publish({ error: message(error) }); return false; }
    let text: string;
    try { text = history?.text ?? (raw !== null ? raw : writeSourceDocument(value, this.state.format, this.document, rename)); boundSource(text); }
    catch (error) { this.publish({ error: message(error) }); return false; }
    try {
      if (!equalJsonDocument(value, this.state.value)) {
        const result: unknown = this.options.onChange(cloneJsonDocument(value));
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => this.report('document-local'));
      }
    } catch { this.report('document-local'); this.publish({ error: 'The local document callback failed. Your edit is retained.' }); return false; }
    if (!this.available()) return false;
    if (remember) this.remember();
    const format = history?.format ?? this.state.format, cache = history?.cache ?? { ...this.state.cache, [format]: text };
    this.publish({ value, raw, format, text, cache, draftValid: history?.draftValid ?? true, error: null, saved: false }); this.raw(raw);
    this.observe('document-source', () => this.options.onSourceChange?.({ format, text, value: cloneJsonDocument(value) })); return true;
  }
  private validateEdit(value: JsonDocumentValue, kind: 'replace' | 'rename' | 'add' | 'remove' | 'code', path: JsonDocumentPath) {
    const problem = this.options.validateEdit?.({ kind, path: [...path], previous: cloneJsonDocument(this.state.value), next: cloneJsonDocument(value) });
    if (problem) throw new Error(problem);
  }
  activate() { this.retired = false; if (this.state.saving && !this.pending) this.publish({ saving: false, saved: false, notice: 'Save interrupted. Your draft is retained.' }); }
  dispose() { this.retired = true; this.generation++; this.pending?.abort(); this.pending = null; }
  updateOptions(options: Options) {
    if (options.disabled && !this.options.disabled) { this.generation++; this.pending?.abort(); this.pending = null; this.publish({ saving: false, saved: false }); }
    this.options = options;
  }
  /** Echoes preserve drafts/history. A concurrent external replacement blocks saving until explicit discard. */
  receive(value: JsonDocumentValue) {
    const admitted = cloneJsonDocument(value);
    if (equalJsonDocument(admitted, this.state.value)) return;
    this.generation++; this.pending?.abort(); this.pending = null;
    let text: string;
    try { text = writeSourceDocument(admitted, this.state.baselineFormat, readSourceDocument(this.state.baselineText, this.state.baselineFormat)); }
    catch (error) { this.publish({ conflict: true, saving: false, error: message(error) }); return; }
    if (this.dirty) {
      this.incoming = { value: admitted, text, format: this.state.baselineFormat }; this.publish({ conflict: true, saving: false, saved: false, error: 'The source document changed. Discard this draft to load the new version before saving.' }); return;
    }
    this.undoStack = []; this.redoStack = []; this.publish({ value: admitted, baseline: cloneJsonDocument(admitted), text, baselineText: text, cache: { [this.state.format]: text }, saving: false, saved: false, error: null });
  }
  receiveSource(format: DocumentFormat, text: string) {
    boundSource(text);
    if (format === this.state.format && (text === this.state.text || text === this.state.raw)) return;
    const parsed = parseDocumentSource(text, format);
    this.generation++; this.pending?.abort(); this.pending = null;
    if (this.dirty) {
      this.incoming = { value: parsed.ok ? parsed.value : cloneJsonDocument(this.state.value), format, text };
      this.publish({ conflict: true, saving: false, saved: false, error: 'The source file changed. Discard this draft before saving.' }); return;
    }
    if (!parsed.ok) {
      let fallback = this.state.text;
      if (format !== this.state.format) {
        try { fallback = writeSourceDocument(this.state.value, format); }
        catch { fallback = writeSourceDocument({}, format); } // Keep the last valid tree frozen even when the new file format cannot represent it.
      }
      this.undoStack = []; this.redoStack = []; this.fresh = null; this.codeTransaction = false;
      this.publish({ format, baselineFormat: format, text: fallback, baselineText: text, baseline: cloneJsonDocument(this.state.value),
        cache: { [format]: fallback }, raw: text, draftValid: false, edit: null, conflict: false, saved: false, saving: false, error: parsed.message });
      return;
    }
    this.undoStack = []; this.redoStack = []; this.publish({ value: parsed.value, baseline: cloneJsonDocument(parsed.value), format, baselineFormat: format, text, baselineText: text, cache: { [format]: text }, raw: null, draftValid: true, edit: null, error: null, saving: false, saved: false });
  }
  receiveRaw(raw: string | null) {
    if (raw === this.state.raw) return;
    if (raw !== null) { boundSource(raw); const parsed = parseDocumentSource(raw, this.state.format); this.publish({ raw, draftValid: parsed.ok && equalJsonDocument(parsed.value, this.state.value) }); }
    else this.publish({ raw, draftValid: true });
  }
  setFormat(format: DocumentFormat): boolean {
    if (!this.available() || !this.finishInline() || this.state.edit) return false;
    if (format === this.state.format) return true;
    if (!this.state.draftValid) { this.publish({ error: 'Fix or revert the Code draft before switching formats.' }); return false; }
    try {
      if (this.state.format === 'toml' && this.document.native.size) throw new Error('This TOML contains native dates or 64-bit integers. Keep TOML to preserve their types.');
      if (documentNeedsExactNumbers(this.document)) throw new Error('Keep this exact-number file in Code; converting its JavaScript projection would lose precision.');
      const cached = this.state.cache[format], previous = cached !== undefined ? readSourceDocument(cached, format) : undefined;
      const text = writeSourceDocument(this.state.value, format, previous);
      this.remember(); this.codeTransaction = false;
      this.publish({ format, text, cache: { ...this.state.cache, [format]: text }, raw: null, draftValid: true, error: null, saved: false, notice: `Converted to ${format === 'env' ? '.env' : format.toUpperCase()}.` }); this.raw(null); this.editing(false);
      this.observe('document-format', () => this.options.onSourceChange?.({ format, text, value: cloneJsonDocument(this.state.value) })); return true;
    } catch (error) { this.publish({ error: message(error) }); return false; }
  }
  begin(path: JsonDocumentPath, kind: 'value' | 'key', fresh = false): boolean {
    if (!this.available() || !this.finishInline() || this.state.edit) return false;
    if (!this.state.draftValid) { this.publish({ error: 'Fix or revert the Code draft before editing the tree.' }); return false; }
    if (documentNeedsExactNumbers(this.document)) { this.publish({ error: 'Edit this exact-number file in Code to preserve numeric precision.' }); return false; }
    if (kind === 'value' && this.document.native.has(jsonPointer(path))) { this.publish({ error: 'Edit this source-native value in Code to preserve its type or alias.' }); return false; }
    const value = readJsonPath(this.state.value, path);
    const type = value === null ? 'auto' : typeof value === 'object' ? (Array.isArray(value) ? 'array' : 'object') : typeof value as JsonInlineType;
    const text = kind === 'key' ? String(path.at(-1) ?? '') : typeof value === 'string' ? value : value === null ? '' : JSON.stringify(value);
    this.codeTransaction = false; this.publish({ edit: { kind, path: [...path], text, type, fresh }, error: null }); this.editing(true); return true;
  }
  changeInline(text: string, type = this.state.edit?.type) {
    if (!this.available() || !this.state.edit || !type) return;
    this.publish({ edit: { ...this.state.edit, text, type }, error: null, saved: false });
  }
  finishInline(): boolean {
    if (!this.state.edit) return true;
    if (!this.available()) return false;
    const edit = this.state.edit;
    try {
      let mutation: JsonMutation;
      if (edit.kind === 'key') mutation = { kind: 'rename', path: edit.path, name: edit.text };
      else {
        let value: JsonDocumentValue;
        const text = edit.text.trim();
        if (edit.type === 'string') value = edit.text;
        else if (edit.type === 'null') value = null;
        else if (edit.type === 'object') value = {};
        else if (edit.type === 'array') value = [];
        else {
          const parsed = parseJsonDocument(text || 'null');
          if (parsed.ok && typeof parsed.value === 'number' && losesDocumentNumberPrecision(text, parsed.value)) throw new Error('This number loses JavaScript precision. Use Code for an exact source value or choose a string.');
          if (edit.type === 'auto') value = parsed.ok ? parsed.value : edit.text;
          else if (!parsed.ok || typeof parsed.value !== edit.type) throw new Error(edit.type === 'number' ? 'Enter a finite JSON number.' : 'Use true or false.');
          else value = parsed.value;
        }
        mutation = { kind: 'replace', path: edit.path, value };
      }
      const next = mutateJsonDocument(this.state.value, mutation);
      this.validateEdit(next.value, mutation.kind, edit.path);
      if (!this.accept(next.value, null, !this.fresh && !equalJsonDocument(next.value, this.state.value), undefined,
        mutation.kind === 'rename' ? { from: jsonPointer(edit.path), to: mutation.name } : undefined)) return false;
      this.publish({ edit: null, notice: 'Local edit applied.' }); this.editing(false);
      if (edit.kind === 'key' && edit.fresh) return this.begin(next.path, 'value', true);
      this.fresh = null; return true;
    } catch (error) { this.publish({ error: message(error) }); return false; }
  }
  mutate(mutation: JsonMutation): JsonDocumentPath | null {
    if (!this.available() || !this.finishInline() || this.state.edit) return null;
    if (!this.state.draftValid) { this.publish({ error: 'Fix or revert the Code draft before editing the tree.' }); return null; }
    try {
      const next = mutateJsonDocument(this.state.value, mutation);
      if (mutation.kind === 'add' && (this.state.format === 'env' || this.state.format === 'toml')) next.value = mutateJsonDocument(next.value, { kind: 'replace', path: next.path, value: '' }).value;
      this.validateEdit(next.value, mutation.kind, mutation.path);
      const before = this.history();
      if (!this.accept(next.value, null)) return null;
      this.codeTransaction = false;
      this.publish({ notice: mutation.kind === 'remove' ? 'Entry removed. Undo is available.' : 'Local edit applied.' });
      if (mutation.kind === 'add') { this.fresh = before; this.begin(next.path, typeof next.path.at(-1) === 'number' ? 'value' : 'key', true); }
      return next.path;
    } catch (error) { this.publish({ error: message(error) }); return null; }
  }
  setRaw(text: string) {
    if (!this.available()) return;
    if (text === this.state.raw) return;
    if (text.length > JSON_DOCUMENT_LIMITS.characters) { this.publish({ error: 'Document source exceeds the text limit.' }); return; }
    if (!this.codeTransaction) { this.remember(); this.codeTransaction = true; }
    const parsed = parseDocumentSource(text, this.state.format);
    if (parsed.ok) {
      try { this.validateEdit(parsed.value, 'code', []); if (!this.accept(parsed.value, text, false)) { this.publish({ raw: text, draftValid: false, saved: false }); this.raw(text); } }
      catch (error) { this.publish({ raw: text, draftValid: false, error: message(error), saved: false }); this.raw(text); }
    } else { this.publish({ raw: text, draftValid: false, error: parsed.message, saved: false }); this.raw(text); }
    this.editing(true);
  }
  cancel() {
    if (!this.available()) return;
    if (this.fresh) { const original = this.fresh; if (!this.accept(original.value, original.raw, false, original)) return; this.fresh = null; this.undoStack.pop(); }
    const previous = this.undoStack.at(-1);
    if (this.codeTransaction && previous?.raw === null && previous.format === this.state.format && previous.text === this.state.text && equalJsonDocument(previous.value, this.state.value)) this.undoStack.pop();
    this.publish({ edit: null, raw: null, draftValid: true, error: null }); this.raw(null); this.editing(false); this.codeTransaction = false;
  }
  commit(): JsonEditorCommitResult<JsonDocumentValue> {
    if (!this.available()) return { ok: false, error: 'This editor is unavailable.' };
    if (!this.finishInline() || this.state.edit) return { ok: false, error: this.state.error ?? 'Finish the new entry before continuing.' };
    if (this.state.conflict) return { ok: false, error: this.state.error ?? 'Resolve the source document change first.' };
    try {
      let value = this.state.value;
      if (this.state.raw !== null) { const parsed = parseDocumentSource(this.state.raw, this.state.format); if (!parsed.ok) throw new Error(parsed.message); value = parsed.value; this.validateEdit(value, 'code', []); }
      if (this.options.validate) value = cloneJsonDocument(this.options.validate(cloneJsonDocument(value)));
      let history: History | undefined;
      if (this.state.raw !== null) {
        const source = readSourceDocument(this.state.raw, this.state.format), text = writeSourceDocument(value, this.state.format, source);
        history = { ...this.history(), value, text, raw: null, draftValid: true, cache: { ...this.state.cache, [this.state.format]: text } };
      }
      if (!this.accept(value, null, !equalJsonDocument(value, this.state.value), history)) return { ok: false, error: this.state.error ?? 'This editor is unavailable.' };
      this.codeTransaction = false; this.editing(false); return { ok: true, value: cloneJsonDocument(value) };
    } catch (error) { const problem = message(error); this.publish({ error: problem }); return { ok: false, error: problem }; }
  }
  undo() { this.restoreHistory(this.undoStack, this.redoStack); }
  redo() { this.restoreHistory(this.redoStack, this.undoStack); }
  private restoreHistory(from: History[], to: History[]) {
    if (!this.available() || !from.length) return;
    const next = from.at(-1)!;
    const before = this.history();
    if (!this.accept(next.value, next.raw, false, next)) return;
    from.pop(); to.push(before);
    this.publish({ edit: null, error: null, notice: 'Local history restored.' });
    this.fresh = null; this.codeTransaction = false; this.editing(next.raw !== null);
  }
  discard() {
    if (!this.available() || this.state.saving) return;
    const target = this.incoming ?? { value: this.state.baseline, format: this.state.baselineFormat, text: this.state.baselineText };
    const parsed = parseDocumentSource(target.text, target.format);
    const fallback = parsed.ok ? target.text : writeSourceDocument({}, target.format);
    const history: History = { ...target, raw: parsed.ok ? null : target.text, text: fallback, cache: { [target.format]: fallback }, draftValid: parsed.ok };
    if (!this.accept(target.value, history.raw, true, history)) return;
    if (this.incoming !== undefined) { this.publish({ baseline: cloneJsonDocument(target.value), baselineText: target.text, baselineFormat: target.format }); this.incoming = undefined; }
    this.fresh = null; this.codeTransaction = false; this.publish({ edit: null, conflict: false, error: parsed.ok ? null : parsed.message, notice: 'Draft discarded.' }); this.editing(!parsed.ok);
  }
  async save(): Promise<boolean> {
    if (!this.options.onSave || !this.available() || this.state.saving) return false;
    const beforeCommit = this.generation, admitted = this.commit(), writer = this.options.onSave;
    // Synchronous validation/local callbacks may retire the document or revoke
    // its writer. Recheck ownership before invoking any application mutation.
    if (!admitted.ok || !writer || !this.available() || this.state.saving || this.generation !== beforeCommit) return false;
    const patch = diffJsonDocument(this.state.baseline, admitted.value), format = this.state.format, text = this.state.text;
    if (!patch.length && format === this.state.baselineFormat && text === this.state.baselineText) return false;
    const token = ++this.generation, controller = new AbortController(); this.pending = controller;
    this.publish({ saving: true, saved: false, error: null, notice: 'Saving…' });
    try {
      const result = writer(cloneJsonDocument(admitted.value), patch, { signal: controller.signal, format, text });
      if (!result || typeof result.then !== 'function') throw new Error('The save callback must return an accepted-write promise.');
      await result;
      if (this.retired || this.options.disabled || token !== this.generation || controller.signal.aborted) return false;
      this.pending = null;
      const stillDirty = this.state.format !== format || this.state.text !== text || diffJsonDocument(admitted.value, this.state.value).length > 0 || this.state.raw !== null || this.state.edit !== null;
      this.publish({ baseline: cloneJsonDocument(admitted.value), baselineFormat: format, baselineText: text, saving: false, saved: !stillDirty,
        notice: stillDirty ? 'Snapshot saved. Newer local changes remain.' : 'Saved.' }); return true;
    } catch (error) {
      if (this.retired || token !== this.generation || controller.signal.aborted) return false;
      this.pending = null; this.publish({ saving: false, saved: false, error: message(error), notice: 'Save failed. Your draft is retained.' }); return false;
    }
  }
}
